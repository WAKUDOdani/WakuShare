import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import {
  assertUnavailableReference,
  projectResourcePath,
  unavailableTarget
} from '../src/main/core/capshare/unavailable-media'
import { verifyLocalMedia } from '../src/main/core/capshare/media-plan'
import { DRAFT_PATH_PLACEHOLDER } from '../src/main/core/capcut/constants'

it('keeps declared lost media confined without creating substitutes or allowing dangerous references', () => {
  const pointer = '/materials/videos/0/path'
  expect(() =>
    assertUnavailableReference('C:/old/video.mp4', pointer, 'draft_content.json')
  ).not.toThrow()
  for (const path of [
    '//server/share/a.mp4',
    'https://host/a.mp4',
    '../../private.png',
    'C:/private/secret.txt',
    'C:/bad.exe'
  ])
    expect(() => assertUnavailableReference(path, pointer, 'draft_content.json')).toThrow()
  const a = unavailableTarget('C:/folder/a.mp4'),
    b = unavailableTarget('C:/another/a.mp4')
  expect(a).toMatch(/^Resources\/unavailable\/[a-f0-9]{64}\/a\.mp4$/)
  expect(a).not.toBe(b)
  expect(projectResourcePath('../../Resources/a.wav', 'subdraft/uuid/draft_content.json')).toBe(
    'Resources/a.wav'
  )
})

it('retains strict self-containment for every reference not explicitly declared unavailable', () => {
  const root = mkdtempSync(join(tmpdir(), 'wakushare-unavailable-'))
  try {
    const target = unavailableTarget('C:/old/source.mp4')
    const value = { materials: { videos: [{ path: `${DRAFT_PATH_PLACEHOLDER}/${target}` }] } }
    const docs = new Map([
      [
        'draft_content.json',
        { relativePath: 'draft_content.json', raw: Buffer.from(JSON.stringify(value)), value }
      ]
    ])
    expect(() => verifyLocalMedia(root, docs)).toThrow(/not self-contained/)
    expect(() => verifyLocalMedia(root, docs, new Set([target]))).not.toThrow()
    value.materials.videos.push({ path: `${DRAFT_PATH_PLACEHOLDER}/Resources/local/omitted.mp4` })
    expect(() => verifyLocalMedia(root, docs, new Set([target]))).toThrow(/not self-contained/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
