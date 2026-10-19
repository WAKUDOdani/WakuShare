import { describe, expect, it } from 'vitest'
import { translateText } from '../src/shared/i18n'
import ru from '../src/shared/locales/ru.json'
import errors from '../src/shared/locales/ru-errors.json'

describe('UI translations', () => {
  it('keeps English source copy and technical data unchanged', () => {
    expect(translateText('Import reviewed selection', 'en')).toBe('Import reviewed selection')
    for (const value of [
      'Мои пресеты2',
      '1012 4',
      'C:/Users/Имя/Video.mov',
      'Custom effect 12',
      '__proto__',
      'toString'
    ]) {
      expect(translateText(value, 'ru')).toBe(value)
    }
  })

  it('translates actions and dynamic warnings without changing paths or substitution characters', () => {
    expect(translateText('Import reviewed selection', 'ru')).toBe('Импортировать выбранное')
    const path = 'C:\\Видео\\$& {1} щёлк.wav'
    expect(translateText(`Preset files are missing: ${path}`, 'ru')).toBe(
      `Отсутствуют файлы пресета: ${path}`
    )
    expect(translateText('Replaced: 2; skipped: 3; merged folders: 1.', 'ru')).toBe(
      'Заменено: 2 · Пропущено: 3 · Объединено папок: 1'
    )
    expect(translateText('Downloading update… 42%', 'ru')).toBe('Загрузка обновления… 42%')
  })

  it('keeps every interpolation field and supplies Russian copy for each catalog entry', () => {
    const fields = (text: string): string[] =>
      [...text.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort()
    for (const [source, translation] of Object.entries({ ...ru, ...errors })) {
      expect(translation, source).toMatch(/[А-Яа-яЁё]/)
      expect(fields(translation), source).toEqual(fields(source))
    }
  })
})
