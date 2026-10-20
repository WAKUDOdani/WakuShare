import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, sep } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../core/fsx'
import type { ExplorerConfiguration, ExplorerProject, ExplorerSource } from '../../shared/explorer'

const key = z.string().regex(/^project-v1-[a-f0-9]{64}$/)
const label = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (value) =>
      !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char === '/' || char === '\\')
  )
const rootPath = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => isAbsolute(value) && !value.includes('\0'))
const projectSchema = z
  .object({
    key,
    draftId: z.uuid(),
    location: rootPath,
    name: z.string().max(256),
    containerFolderId: z.uuid()
  })
  .strict()
const sourceSchema = z
  .object({
    id: z.uuid(),
    label,
    rootPath,
    scope: z.enum(['global', 'project']),
    projectKey: key.nullable(),
    enabled: z.boolean(),
    detached: z.boolean()
  })
  .strict()
export const configurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    enabled: z.boolean(),
    sources: z.array(sourceSchema).max(256),
    projects: z.array(projectSchema).max(1024),
    attachments: z
      .array(
        z
          .object({
            id: z.uuid(),
            sourceId: z.uuid(),
            projectKey: key,
            destinationFolderId: z.uuid()
          })
          .strict()
      )
      .max(262144),
    overrides: z
      .array(z.object({ sourceId: z.uuid(), projectKey: key, enabled: z.boolean() }).strict())
      .max(262144)
  })
  .strict()

export class ExplorerConfigurationError extends Error {
  constructor(
    readonly code: string,
    readonly relatedSourceId?: string
  ) {
    super(code)
    this.name = 'ExplorerConfigurationError'
  }
}
export function within(root: string, path: string): boolean {
  const part = relative(root, path)
  return !part || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep))
}
function overlaps(a: string, b: string): boolean {
  return within(a, b) || within(b, a)
}
function sameScope(a: ExplorerSource, b: ExplorerSource): boolean {
  return a.scope === 'global' || b.scope === 'global' || a.projectKey === b.projectKey
}
function normalized(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase()
}
export function effectiveSources(
  config: ExplorerConfiguration,
  projectKey: string
): ExplorerSource[] {
  return config.sources.filter(
    (source) =>
      !source.detached &&
      source.enabled &&
      (source.scope === 'global' || source.projectKey === projectKey) &&
      !config.overrides.some(
        (override) =>
          override.sourceId === source.id && override.projectKey === projectKey && !override.enabled
      )
  )
}
export function observableRoots(config: ExplorerConfiguration): string[] {
  return config.enabled
    ? [
        ...new Map(
          config.sources
            .filter((source) => !source.detached && source.enabled)
            .map((source) => [normalized(source.rootPath), source.rootPath])
        ).values()
      ].sort()
    : []
}
function validate(config: ExplorerConfiguration): ExplorerConfiguration {
  const value = configurationSchema.parse(config)
  const unique = (values: string[]): boolean => new Set(values).size === values.length
  if (
    !unique(value.sources.map((source) => source.id)) ||
    !unique(value.projects.map((project) => project.key)) ||
    !unique(value.attachments.map((attachment) => attachment.id)) ||
    !unique(
      value.attachments.map((attachment) => attachment.projectKey + '/' + attachment.sourceId)
    ) ||
    !unique(value.overrides.map((override) => override.projectKey + '/' + override.sourceId)) ||
    !unique([
      ...value.projects.map((project) => project.containerFolderId),
      ...value.attachments.map((attachment) => attachment.destinationFolderId)
    ])
  )
    throw new ExplorerConfigurationError('EXPLORER_CONFIGURATION_INVALID')
  for (const source of value.sources) {
    if (
      (source.scope === 'global') !== (source.projectKey === null) ||
      (source.projectKey && !value.projects.some((project) => project.key === source.projectKey))
    )
      throw new ExplorerConfigurationError('EXPLORER_CONFIGURATION_INVALID')
  }
  for (const attachment of value.attachments) {
    const source = value.sources.find((source) => source.id === attachment.sourceId)
    if (
      !source ||
      !value.projects.some((project) => project.key === attachment.projectKey) ||
      (source.scope === 'project' && source.projectKey !== attachment.projectKey)
    )
      throw new ExplorerConfigurationError('EXPLORER_CONFIGURATION_INVALID')
  }
  for (const override of value.overrides)
    if (
      !value.sources.some(
        (source) => source.id === override.sourceId && source.scope === 'global'
      ) ||
      !value.projects.some((project) => project.key === override.projectKey)
    )
      throw new ExplorerConfigurationError('EXPLORER_CONFIGURATION_INVALID')
  const active = value.sources.filter((source) => !source.detached)
  for (let i = 0; i < active.length; ++i)
    for (let j = i + 1; j < active.length; ++j)
      if (sameScope(active[i], active[j]) && overlaps(active[i].rootPath, active[j].rootPath))
        throw new ExplorerConfigurationError('EXPLORER_SOURCE_OVERLAP', active[j].id)
  return value
}

export class ExplorerConfigurationStore {
  private cached: ExplorerConfiguration | null = null
  private loadedHash: string | null = null
  private serial: Promise<unknown> = Promise.resolve()
  constructor(
    readonly filePath: string,
    private readonly resolveSource: (path: string) => Promise<string>
  ) {}
  async read(): Promise<ExplorerConfiguration> {
    if (!this.cached) {
      try {
        const bytes = await readFile(this.filePath)
        if (bytes.length > 16 * 1024 * 1024) throw new Error('Large configuration')
        this.cached = validate(JSON.parse(bytes.toString('utf8')))
        this.loadedHash = this.hash(bytes)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new ExplorerConfigurationError('EXPLORER_CONFIGURATION_UNREADABLE')
        this.cached = {
          schemaVersion: 1,
          revision: 0,
          enabled: false,
          sources: [],
          projects: [],
          attachments: [],
          overrides: []
        }
        this.loadedHash = null
      }
    }
    return structuredClone(this.cached)
  }
  async enabled(expected: number, enabled: boolean): Promise<ExplorerConfiguration> {
    return this.edit(expected, (config) => {
      config.enabled = enabled
    })
  }
  async add(
    expected: number,
    input: { rootPath: string; label?: string; projectKey?: string }
  ): Promise<ExplorerConfiguration> {
    return this.edit(expected, async (config) => {
      if (input.projectKey && !config.projects.some((project) => project.key === input.projectKey))
        throw new ExplorerConfigurationError('EXPLORER_NO_PROJECT')
      const path = await this.resolveSource(input.rootPath)
      const existing = config.sources.find(
        (source) =>
          normalized(source.rootPath) === normalized(path) &&
          source.projectKey === (input.projectKey ?? null)
      )
      if (existing) {
        existing.detached = false
        existing.enabled = true
        return
      }
      const candidate: ExplorerSource = {
        id: randomUUID(),
        label: label.parse(input.label ?? (basename(path).slice(0, 80) || 'Folder')),
        rootPath: path,
        scope: input.projectKey ? 'project' : 'global',
        projectKey: input.projectKey ?? null,
        enabled: true,
        detached: false
      }
      const conflict = config.sources.find(
        (source) =>
          !source.detached &&
          sameScope(source, candidate) &&
          overlaps(source.rootPath, candidate.rootPath)
      )
      if (conflict) throw new ExplorerConfigurationError('EXPLORER_SOURCE_OVERLAP', conflict.id)
      config.sources.push(candidate)
    })
  }
  async source(
    expected: number,
    id: string,
    update: { label?: string; enabled?: boolean; detached?: boolean }
  ): Promise<ExplorerConfiguration> {
    return this.edit(expected, (config) => {
      const source = config.sources.find((source) => source.id === id && !source.detached)
      if (!source) throw new ExplorerConfigurationError('EXPLORER_SOURCE_NOT_FOUND')
      if (update.label !== undefined) source.label = label.parse(update.label)
      if (update.enabled !== undefined) source.enabled = update.enabled
      if (update.detached !== undefined) source.detached = update.detached
    })
  }
  async projectOverride(
    expected: number,
    sourceId: string,
    projectKey: string,
    enabled: boolean
  ): Promise<ExplorerConfiguration> {
    return this.edit(expected, (config) => {
      if (!config.projects.some((project) => project.key === projectKey))
        throw new ExplorerConfigurationError('EXPLORER_NO_PROJECT')
      if (
        !config.sources.some(
          (source) => source.id === sourceId && source.scope === 'global' && !source.detached
        )
      )
        throw new ExplorerConfigurationError('EXPLORER_SOURCE_NOT_FOUND')
      config.overrides = config.overrides.filter(
        (override) => override.sourceId !== sourceId || override.projectKey !== projectKey
      )
      if (!enabled) config.overrides.push({ sourceId, projectKey, enabled })
    })
  }
  /** Called only with an OS-verified worker observation, never renderer data. */
  async registerProject(
    project: Omit<ExplorerProject, 'containerFolderId'>
  ): Promise<ExplorerConfiguration> {
    return this.edit(null, (config) => {
      const existing = config.projects.find((candidate) => candidate.key === project.key)
      if (existing) {
        if (
          existing.draftId.toUpperCase() !== project.draftId.toUpperCase() ||
          normalized(existing.location) !== normalized(project.location)
        )
          throw new ExplorerConfigurationError('EXPLORER_PROJECT_CONFLICT')
        existing.name = project.name
      } else config.projects.push({ ...project, containerFolderId: randomUUID() })
    })
  }
  private edit(
    expected: number | null,
    change: (config: ExplorerConfiguration) => void | Promise<void>
  ): Promise<ExplorerConfiguration> {
    const operation = this.serial.then(async () => {
      const before = await this.read()
      if (expected !== null && expected !== before.revision)
        throw new ExplorerConfigurationError('EXPLORER_CONFIGURATION_CHANGED')
      const next = structuredClone(before)
      await change(next)
      for (const project of next.projects)
        for (const source of next.sources.filter(
          (source) =>
            !source.detached && (source.scope === 'global' || source.projectKey === project.key)
        ))
          if (
            !next.attachments.some(
              (attachment) =>
                attachment.projectKey === project.key && attachment.sourceId === source.id
            )
          )
            next.attachments.push({
              id: randomUUID(),
              sourceId: source.id,
              projectKey: project.key,
              destinationFolderId: randomUUID()
            })
      validate(next)
      if (JSON.stringify(next) === JSON.stringify(before)) return before
      let current: Buffer | null = null
      try {
        current = await readFile(this.filePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if ((current ? this.hash(current) : null) !== this.loadedHash) {
        this.cached = null
        throw new ExplorerConfigurationError('EXPLORER_CONFIGURATION_CHANGED')
      }
      next.revision++
      validate(next)
      const bytes = Buffer.from(JSON.stringify(next, null, 2))
      await mkdir(dirname(this.filePath), { recursive: true })
      await atomicWriteFile(this.filePath, bytes)
      this.cached = next
      this.loadedHash = this.hash(bytes)
      return structuredClone(next)
    })
    this.serial = operation.catch(() => {})
    return operation
  }
  private hash(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex')
  }
}
