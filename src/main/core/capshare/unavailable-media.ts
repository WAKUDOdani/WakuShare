import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { DRAFT_PATH_PLACEHOLDER } from '../capcut/constants'
import { classifyString, normalizeResourcePath } from '../capcut/scanner'
import {
  MEDIA_RESOURCE,
  assertExportResource,
  assertRelativeResource,
  isResourceField
} from '../reference-policy'
import { archiveError } from '../archive-safety'
import { sanitizeFolderName } from '../fsx'

export function isLibraryResource(value: string, pointer: string): boolean {
  if (pointer.includes('draft_materials_copied_info')) return false
  if (MEDIA_RESOURCE.test(value) && isResourceField(pointer)) return true
  return (
    /(?:^|\/)subdraft\/[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\/(?:draft_content|draft_info|sub_draft_config)\.json$/i.test(
      normalizeResourcePath(value)
    ) &&
    /\/(?:materials\/drafts\/\d+\/(?:draft_file_path|draft_config_path)|draft_materials\/\d+\/value\/\d+\/file_Path)$/.test(
      pointer
    )
  )
}

/** Interpret project/document-relative references without escaping the project. */
export function projectResourcePath(
  value: string,
  document: string,
  folder?: string
): string | null {
  const item = classifyString(value, { draftFolderJson: folder })
  let relative: string
  if (item.cls === 'draft-internal') relative = item.draftRelative!
  else if (item.cls === 'placeholder')
    relative = item.normalized.slice(DRAFT_PATH_PLACEHOLDER.length).replace(/^\//, '')
  else if (item.cls === 'relative')
    relative = /^\.{1,2}\//.test(item.normalized)
      ? posix.normalize(posix.join(posix.dirname(document), item.normalized))
      : item.normalized
  else return null
  return assertRelativeResource(relative)
}

export function assertUnavailableReference(
  value: string,
  pointer: string,
  document: string,
  folder?: string
): void {
  if (!isLibraryResource(value, pointer))
    throw archiveError('Invalid unavailable resource reference')
  const item = classifyString(value, { draftFolderJson: folder })
  if (item.cls === 'url' || item.cls === 'unc')
    throw archiveError('Network references cannot be declared as unavailable media')
  if (projectResourcePath(value, document, folder) === null) {
    if (MEDIA_RESOURCE.test(item.normalized)) assertExportResource(item.normalized)
    else assertRelativeResource(item.normalized.replace(/^(?:[a-z]:\/|\/)/i, ''))
  }
}

/** No file is fabricated. CapCut sees the original unavailable state at a
 * confined, non-existent destination, never the old machine's external path. */
export function unavailableTarget(value: string): string {
  const original = normalizeResourcePath(value)
  const identity = createHash('sha256').update(original).digest('hex')
  return assertRelativeResource(
    `Resources/unavailable/${identity}/${sanitizeFolderName(original.split('/').pop() || 'source', 'windows')}`
  )
}
