export function syncDiagnostic(reason: string, translate: (key: string) => string): string {
  if (!reason.startsWith('AUTOSYNC|')) return translate(reason)
  const [, operation, code, ...details] = reason.split('|')
  const detail = details.join('|')
  const operations: Record<string, string> = {
    connect: 'Connecting to CapCut',
    read: 'Reading the media library',
    add: 'Adding files',
    folders: 'Synchronizing folders',
    rename: 'Renaming sources',
    move: 'Moving sources',
    remove: 'Removing media cards',
    restore: 'Restoring media cards',
    view: 'Refreshing the media library',
    native: 'CapCut adapter'
  }
  const codes: Record<string, string> = {
    native_rejected: 'CapCut rejected the operation before changing data.',
    shared_timeline_source:
      'The source is shared by multiple timelines. Automatic relinking is paused.',
    used_source: 'The source is used by a timeline. Its media card is retained.',
    project_settling: 'CapCut is still preparing the project. No change was dispatched.',
    preflight_failed:
      'The project could not be verified before synchronization. No change was dispatched.',
    vendor_import_unavailable: 'A required function is missing from a CapCut library.',
    object_scope_limit: 'The CapCut interface exceeded the safe inspection limit.',
    interface_unavailable: 'Required CapCut interface is missing or ambiguous.',
    module_unavailable: 'Required CapCut module is not loaded.',
    module_identity_changed: 'CapCut modules belong to different installations.',
    hardware_fault:
      'CapCut interface access failed. Completion is unknown; the command will not be repeated.',
    adapter_failed: 'The CapCut adapter failed. See the diagnostic journal.',
    preservation_conflict:
      'Project comparison found changes outside the requested operation. Synchronization is paused.',
    catalog_path_mismatch: 'A media card and its source path disagree. Synchronization is paused.',
    catalog_unavailable: 'The complete media library could not be verified.',
    completion_unknown: 'Command completion is unknown. Automatic replay is disabled.',
    disconnected: 'The connection to CapCut was closed.',
    bootstrap_failed: 'The CapCut adapter could not connect. See the diagnostic journal.'
  }
  if (operation === 'view')
    return `${translate('Refreshing the media library')}: ${translate('Data verification passed, but the list refresh is unconfirmed. Reopen the project to refresh it.')} ${code}`
  return `${translate(operations[operation] || 'CapCut adapter')}: ${translate(codes[code] || 'The CapCut interface changed.')} ${code === 'hardware_fault' ? (detail || '').split(':')[0] : detail || ''}`.trim()
}
