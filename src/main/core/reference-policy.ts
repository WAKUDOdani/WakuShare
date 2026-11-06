import { archiveError, validateArchivePath } from './archive-safety'
import { assertDataFilename } from './payload-policy'
import { normalizeResourcePath, normalizeSlashes } from './capcut/scanner'

export const MEDIA_RESOURCE =
  /\.(?:mp4|mov|mkv|avi|webm|m4v|mpg|mpeg|ts|mts|m2ts|wmv|flv|3gp|wav|mp3|m4a|aac|flac|ogg|aif|aiff|wma|opus|png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif|svg|ico|ttf|otf|ttc|woff2?|srt)$/i

/** A package must not turn export into a reader of arbitrary local/network files. */
export function assertExportResource(path: string, allowDocument = false, pointer = ''): void {
  const normalized = normalizeResourcePath(path)
  if (normalized.startsWith('//') || /^(?:file|smb|sftp|ftp):/i.test(normalized))
    throw archiveError('Network resource references are not supported in transferable packages')
  assertDataFilename(normalized.split('/').pop() ?? '')
  if (
    !MEDIA_RESOURCE.test(normalized) &&
    !(
      allowDocument &&
      (/(?:^|\/)(?:draft_content|draft_info|project)\.json$/i.test(normalized) ||
        (/\/materials\/drafts\/\d+\/draft_config_path$/i.test(pointer) &&
          /(?:^|\/)sub_draft_config\.json$/i.test(normalized)))
    )
  )
    throw archiveError(
      `An external reference is not a supported media, font or preset document: ${normalized}`
    )
}

/** These paths describe the original storage location, not transferable dependencies. */
export function isProvenanceField(pointer: string): boolean {
  return (
    pointer.includes('draft_materials_copied_info') ||
    /\/(?:draft_fold_path|draft_root_path)$/.test(pointer)
  )
}

export function assertRelativeResource(path: string): string {
  const normalized = normalizeSlashes(path).replace(/^\.\//, '')
  validateArchivePath(normalized)
  assertDataFilename(normalized)
  return normalized
}

export function isResourceField(pointer: string): boolean {
  return /\/(?:[^/]*(?:path|uri|url)|src|source|file|font_file|font|effect|media|asset|resource|cover|directory|folder)$/i.test(
    pointer
  )
}

export function assertResourceScheme(value: string, pointer: string): void {
  if (!isResourceField(pointer) || /^[a-z]:[/\\]/i.test(value)) return
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^https?:\/\//i.test(value))
    throw archiveError('Unsupported resource URI scheme')
}

export function isExternalResource(value: string, pointer: string, allowDocument = false): boolean {
  return (
    isResourceField(pointer) ||
    MEDIA_RESOURCE.test(value) ||
    (allowDocument && /(?:^|[/\\])(?:draft_content|draft_info|project)\.json$/i.test(value))
  )
}
