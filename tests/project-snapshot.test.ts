import { expect, it } from 'vitest'
import { portableProjectDocuments, type ProjectDocument } from '../src/main/core/capcut/project'

const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const c = '33333333-3333-4333-8333-333333333333'
const documents = (values: Record<string, unknown>): Map<string, ProjectDocument> =>
  new Map(
    Object.entries(values).map(([relativePath, value]) => [
      relativePath,
      {
        relativePath,
        value: value as ProjectDocument['value'],
        raw: Buffer.from(JSON.stringify(value))
      }
    ])
  )

it('keeps unknown legacy shapes and media-only folders conservative', () => {
  const legacy = portableProjectDocuments(
    documents({ [`subdraft/${a}/draft_content.json`]: { id: a } })
  )
  expect(legacy.documents.size).toBe(1)
  const modern = portableProjectDocuments(
    documents({ 'Timelines/project.json': { timelines: [] } })
  )
  expect(modern.excludes(`subdraft/${b}/cover.png`)).toBe(false)
})

it('retains UUID keys and decoded embedded references while removing unowned cycles', () => {
  const docs = documents({
    'Timelines/project.json': { unknown: { [a]: {} } },
    [`subdraft/${a}/draft_content.json`]: {
      embedded: JSON.stringify({ reference: b }).replace(b, String.raw`\u0032` + b.slice(1))
    },
    [`subdraft/${b}/draft_content.json`]: { back: a },
    [`subdraft/${c}/draft_content.json`]: { self: c }
  })
  const before = JSON.stringify([...docs])
  const result = portableProjectDocuments(docs)
  expect(result.documents.has(`subdraft/${a}/draft_content.json`)).toBe(true)
  expect(result.documents.has(`subdraft/${b}/draft_content.json`)).toBe(true)
  expect(result.excludes(`subdraft/${c}/sub_draft_config.json`)).toBe(true)
  expect(JSON.stringify([...docs])).toBe(before)
})
