import { z } from 'zod'

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const text = z.string().max(8192)
const project = z
  .object({
    DraftId: z.uuid(),
    Location: text,
    Value: z.string().regex(/^project-v1-[a-f0-9]{64}$/)
  })
  .strict()
const editor = z
  .object({
    Status: z.enum(['Connecting', 'Project', 'Home', 'Unavailable', 'Disconnected', 'Faulted']),
    ProcessId: z.number().int().positive(),
    ConnectionId: z.uuid(),
    Generation: counter,
    Sequence: counter,
    ViewEpoch: counter,
    Project: project.nullable(),
    Reason: text.nullable()
  })
  .strict()
  .refine((value) => (value.Status === 'Project') === (value.Project !== null))

export const workerStateSchema = z
  .object({
    phase: z.enum(['Paused', 'Running', 'Stopped', 'Faulted']),
    planningOnly: z.boolean(),
    editorCommands: counter,
    nativeStatus: z
      .enum(['Waiting', 'Applying', 'Verified', 'Unknown', 'Conflict', 'Superseded'])
      .nullable()
      .optional()
      .default(null),
    nativeReason: text.nullable().optional().default(null),
    nativeBusy: z.boolean().optional(),
    nativeMode: z.enum(['laboratory', 'product']).nullable().optional(),
    sources: counter,
    pending: counter,
    importProgress: z
      .object({
        projectKey: z.string().regex(/^project-v1-[a-f0-9]{64}$/),
        total: counter,
        imported: counter,
        skipped: counter,
        phase: z.enum([
          'preparing',
          'folders',
          'importing',
          'placing',
          'checking',
          'ready',
          'waiting',
          'stopped'
        ])
      })
      .strict()
      .refine((p) => p.imported + p.skipped <= p.total)
      .nullable()
      .optional(),
    runtimeEpoch: counter,
    batches: counter,
    configurationRevision: counter.optional().default(0),
    inventoryRoots: z
      .array(
        z
          .object({
            RootPath: text,
            Available: z.boolean(),
            Complete: z.boolean(),
            Files: counter,
            WaitingFiles: counter,
            Warnings: z.array(text).max(64)
          })
          .strict()
      )
      .max(1024)
      .optional()
      .default([]),
    work: z
      .object({
        FullScans: counter,
        PartialScans: counter,
        MetadataEntries: counter,
        HashedFiles: counter,
        HashedBytes: counter
      })
      .strict(),
    readiness: z
      .object({
        WaitingFiles: counter,
        ScheduledFiles: counter,
        ExhaustedFiles: counter,
        TotalAttempts: counter,
        DeferredFiles: counter
      })
      .strict(),
    watches: z
      .array(
        z.object({ RootPath: text, Status: z.string().max(128), Reason: text.nullable() }).strict()
      )
      .max(1024),
    editor: editor.nullable().optional().default(null),
    editorBlocked: z.boolean(),
    blockedProjects: z.array(text).max(8192)
  })
  .strict()
export type WorkerState = z.infer<typeof workerStateSchema>

export const capabilitySchema = z
  .object({
    planningOnly: z.boolean(),
    nativeDispatch: z.boolean(),
    runtimeConfiguration: z.boolean(),
    maxFrameChars: z.number().int().positive().max(32768),
    replayWindow: z.number().int().positive().max(1024),
    recurringScanTimers: z.literal(0),
    nativeObservation: z.boolean().optional().default(false),
    nativeManaged: z.boolean().optional().default(false)
  })
  .strict()
export type WorkerCapabilities = z.infer<typeof capabilitySchema>

// Main-process bootstrap only. Never send this token to a renderer or a log.
export const bootstrapSchema = z
  .object({
    PipeName: z.string().regex(/^wakushare-explorer-[a-f0-9]{32}$/),
    Token: z.string().regex(/^[a-f0-9]{64}$/),
    ConnectionId: z.uuid(),
    ProcessId: z.number().int().positive()
  })
  .strict()
export type NativeBootstrap = z.infer<typeof bootstrapSchema>

export const envelopeSchema = z
  .object({
    protocolVersion: z.literal(1),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    type: z.enum(['response', 'event']),
    requestId: z.string().max(64).nullable(),
    payload: z.unknown()
  })
  .strict()
export const readySchema = z
  .object({
    name: z.literal('ready'),
    state: workerStateSchema,
    capabilities: capabilitySchema,
    bridge: bootstrapSchema.nullable().optional().default(null)
  })
  .strict()
export const responseSchema = z
  .object({
    ok: z.boolean(),
    result: z.unknown(),
    error: z.string().max(2048).nullable()
  })
  .strict()
export const eventSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('stateChanged'), state: workerStateSchema }).strict(),
  z.object({ name: z.literal('editorChanged'), state: workerStateSchema }).strict(),
  z
    .object({
      name: z.literal('stopped'),
      reason: z.enum(['Requested', 'ParentDisconnected']),
      state: workerStateSchema
    })
    .strict(),
  z
    .object({ name: z.literal('fault'), code: z.string().max(128), state: workerStateSchema })
    .strict()
])
