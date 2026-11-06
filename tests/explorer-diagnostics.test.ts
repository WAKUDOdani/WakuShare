import { describe, expect, it } from 'vitest'
import { syncDiagnostic } from '../src/renderer/src/features/explorer/diagnostics'

describe('autosync diagnostics', () => {
  it('names the unavailable operation and interface', () => {
    expect(syncDiagnostic('AUTOSYNC|rename|interface_unavailable|media.rename', (s) => s)).toBe(
      'Renaming sources: Required CapCut interface is missing or ambiguous. media.rename'
    )
  })
  it('keeps an uncertain native fault distinct from a missing interface', () => {
    expect(syncDiagnostic('AUTOSYNC|native|hardware_fault|0xc0000005', (s) => s)).toContain(
      'Completion is unknown; the command will not be repeated.'
    )
  })
  it('retains existing translations', () => {
    expect(syncDiagnostic('Check source folders', (s) => `translated ${s}`)).toBe(
      'translated Check source folders'
    )
  })
})
