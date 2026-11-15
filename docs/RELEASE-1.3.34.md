# WakuShare 1.3.34 - Точные предупреждения об исходниках

<details>
<summary><strong>English release notes</strong></summary>

### WakuShare 1.3.34 - More accurate missing media warnings

A missing voice enhancement cache no longer triggers a missing-source warning when the effect is disabled. The fix also applies to existing packages once their archived settings confirm the cache is unused.

### Download

- [**Windows x64 installer**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.34/WakuShare-1.3.34-setup-x64.exe) - regular installation.
- [**Windows x64 Portable**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.34/WakuShare-1.3.34-portable-x64.exe) - no installation, manual updates.

### Changes and verification

- Export without optional caches keeps resources the project still references as required media, including existing audio output for active voice enhancement. Missing required sources are still reported.
- Import previews show the paths of missing files in the selected interface language.
- Passed 362 automated tests. Verified the reported CapCut 9.6.0 package through isolated import and re-export on Windows. All four video checksums and the tracks of all four timelines matched. Verification used the project files outside the running editor. The sync runtime from 1.3.31 is reused.

Verify downloads with `SHA256SUMS.txt`. Fully exit WakuShare before updating Portable.

</details>

Отсутствующий кеш улучшения голоса больше не вызывает предупреждение о потерянном исходнике, если эффект выключен. Исправление действует и для старых пакетов, если выключенный эффект подтверждается настройками проекта в архиве.

## Скачать

- [**Установщик Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.34/WakuShare-1.3.34-setup-x64.exe) - обычная установка.
- [**Portable Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.34/WakuShare-1.3.34-portable-x64.exe) - запуск без установки, обновление вручную.

## Изменения

- Экспорт без дополнительных кешей сохраняет ресурсы, на которые проект по-прежнему ссылается как на необходимые медиа, в том числе готовый результат включённого улучшения голоса. Проверка отсутствующих исходников сохранена.
- Предпросмотр импорта показывает пути отсутствующих файлов на языке интерфейса.

<details>
<summary>Проверка и технические подробности</summary>

Пройдены 362 автоматических теста. Пакет из CapCut 9.6.0, на котором сообщили об ошибке, прошёл импорт в отдельную папку и повторный экспорт под Windows. Совпали контрольные суммы четырёх видео и дорожки всех четырёх шкал. Проверка выполнялась по файлам проекта вне запущенного редактора. В выпуске используется модуль синхронизации из 1.3.31.

Контрольные суммы опубликованы в `SHA256SUMS.txt`. Перед обновлением Portable полностью закрой WakuShare.

</details>

---

WakuShare поддерживает **WAKUDO Dani**. [Telegram](https://t.me/WAKUDOdani)

Основа / Based on [CapShare by Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.
