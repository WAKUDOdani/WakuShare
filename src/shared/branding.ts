export const BRAND = {
  name: 'WakuShare',
  repository: 'https://github.com/WAKUDOdani/WakuShare',
  telegram: 'https://t.me/WAKUDOdani',
  upstream: 'https://github.com/ilyassesalama/CapShare'
} as const

/** Explicit public feed: no upstream releases or client-side credentials. */
export const UPDATE_FEED = {
  provider: 'github',
  owner: 'WAKUDOdani',
  repo: 'WakuShare',
  private: false,
  releaseType: 'release'
} as const
