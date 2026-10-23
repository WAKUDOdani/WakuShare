import { packageView } from '../shared/package-open'

/** Hold OS file requests until the renderer has subscribed, including reloads. */
export class PackageOpenRequests {
  private pending: string | null = null
  private ready = false

  receive(path: string): string | null {
    if (!packageView(path)) return null
    if (this.ready) return path
    this.pending = path
    return null
  }

  loading(): void {
    this.ready = false
  }

  rendererReady(): string | null {
    this.ready = true
    const path = this.pending
    this.pending = null
    return path
  }
}
