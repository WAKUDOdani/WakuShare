import ru from './locales/ru.json'
import ruErrors from './locales/ru-errors.json'
import type { AppSettings } from './types'

export type Language = AppSettings['language']
const catalog: Readonly<Record<string, string>> = { ...ru, ...ruErrors }
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const templates = Object.entries(catalog)
  .filter(([key]) => /\{\d+\}/.test(key))
  .map(([key, value]) => {
    const fields: string[] = []
    let previous = 0,
      pattern = '^'
    for (const match of key.matchAll(/\{(\d+)\}/g)) {
      pattern += escape(key.slice(previous, match.index)).replace(/\s+/g, '\\s+') + '([\\s\\S]*?)'
      fields.push(match[1])
      previous = match.index! + match[0].length
    }
    return {
      regex: new RegExp(pattern + escape(key.slice(previous)).replace(/\s+/g, '\\s+') + '$'),
      fields,
      value
    }
  })

/** Product copy only. Never pass project/preset names or file paths alone for translation. */
export function translateText(text: string, language: Language): string {
  if (language !== 'ru') return text
  if (Object.prototype.hasOwnProperty.call(catalog, text)) return catalog[text]
  for (const template of templates) {
    const match = template.regex.exec(text)
    if (match) {
      const fields = Object.fromEntries(
        template.fields.map((field, index) => [field, match[index + 1]])
      )
      return template.value.replace(/\{(\d+)\}/g, (_token, field) => fields[field] ?? '')
    }
  }
  return text
}
