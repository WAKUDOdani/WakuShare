import type { JSX } from 'react'

export function BrandWordmark(): JSX.Element {
  return (
    <span aria-label="WakuShare" className="inline-flex font-bold tracking-tight">
      <span aria-hidden="true">Waku</span>
      <span aria-hidden="true" className="waku-share-gradient">
        Share
      </span>
    </span>
  )
}
