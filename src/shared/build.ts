declare const __WAKUSHARE_PREVIEW__: boolean

/** Replaced at build time; public builds default to the normal application. */
export function isLocalPreview(): boolean {
  return typeof __WAKUSHARE_PREVIEW__ !== 'undefined' && __WAKUSHARE_PREVIEW__
}
