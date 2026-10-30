import type { ExplorerConfiguration, ExplorerSource } from './explorer'

export const folderPathKey = (path: string): string =>
  path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
/** One visible row per physical root, preferring this project's own durable connection. */
export function projectFolderChoices(
  config: ExplorerConfiguration,
  projectKey: string
): { source: ExplorerSource; enabled: boolean }[] {
  const roots = new Map<string, ExplorerSource>()
  for (const source of config.sources) {
    if (source.scope !== 'project' || source.detached) continue
    const root = folderPathKey(source.rootPath)
    if (!roots.has(root) || source.projectKey === projectKey) roots.set(root, source)
  }
  return [...roots.values()]
    .map((source) => ({ source, enabled: source.projectKey === projectKey && source.enabled }))
    .sort((a, b) => a.source.label.localeCompare(b.source.label, undefined, { numeric: true }))
}
