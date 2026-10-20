/** The archive contract is unchanged; legacy CapShare packages remain readable. */
export const PROJECT_EXTENSION = 'wakushare'
export const PROJECT_IMPORT_EXTENSIONS = [PROJECT_EXTENSION, 'capshare']

export function isProjectPackage(path: string): boolean {
  return /\.(?:wakushare|capshare)$/i.test(path)
}
