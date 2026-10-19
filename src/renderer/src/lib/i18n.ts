import { useSyncExternalStore } from 'react'
import { translateText, type Language } from '@shared/i18n'

let language: Language = 'en'
const listeners = new Set<() => void>()
export const getLanguage = (): Language => language
export const t = (text: string, values?: unknown[]): string => {
  const translated = translateText(text, language)
  return values
    ? translated.replace(/\{(\d+)\}/g, (_token, index) =>
        values[index] == null || values[index] === false ? '' : String(values[index])
      )
    : translated
}
export function setLanguage(next: Language): void {
  document.documentElement.lang = next
  if (language === next) return
  language = next
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function useLanguage(): Language {
  return useSyncExternalStore(subscribe, getLanguage)
}
