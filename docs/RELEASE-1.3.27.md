# WakuShare 1.3.27 - Точный экспорт и единый интерфейс

<details>
<summary><strong>English release notes</strong></summary>

### WakuShare 1.3.27 - Accurate exports and a consistent interface

This release combines export and startup fixes with the typography improvements approved during local testing after 1.3.22.

### Download

- [**Windows x64 installer**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.27/WakuShare-1.3.27-setup-x64.exe) - regular installation.
- [**Windows x64 Portable**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.27/WakuShare-1.3.27-portable-x64.exe) - no installation; manual updates.

### Improvements and fixes

- **Consistent typography.** Buttons, headings, captions, and item names now share consistent sizes and weights across the app. Main import and export actions use matching dimensions and spacing.
- **Stable import layout.** Replace or import-as-copy choices appear inside the project card. The Open CapCut button keeps its size while loading; overlapping requests are blocked.
- **CapCut startup.** The official launcher is used and the editor window is observed. If the launcher exits completely without a window or remaining processes, one recovery attempt is made. A hidden running process is not restarted automatically.
- **More accurate exports.** Detached saved compositions no longer cause false missing-source warnings. All timelines and the complete current media library are preserved, including referenced nested compositions.
- A missing generated project cover is no longer treated as missing source media. Unavailable video, audio, images, and fonts still produce warnings. Progress uses the actual snapshot contents.
- Refreshed sharp Russian and English interface screenshots.

### Compatibility and verification

Tested target: **CapCut International Windows 9.6.0.4097, x64**. Other editor builds require separate testing. Export preserves timelines and the media library. Close CapCut before importing presets.

324 automated tests passed (8 opt-in tests skipped), with TypeScript, ESLint, package verification and exact runtime checks. File round trips on copies of real project structures checked timeline and library preservation using inert media; these were not full multi-gigabyte media transfers. CapCut startup was also observed with the real editor. The interface was checked in Russian and English at normal and narrow widths, including reduced motion. Documentation screenshots use the actual renderer with demonstration data, captured as lossless 3x PNGs.

The accepted local binaries are published unchanged after independent Windows CI verification. Versions 1.3.23-1.3.26 were local preparation stages. Builds remain unsigned. **Fully exit the previous Portable through the system tray before launching the new EXE.** Settings use the existing WakuShare profile. Download one EXE; checksums are in `SHA256SUMS.txt`. The runtime ZIP, `latest.yml`, and `.blockmap` are build/update resources, not additional manual installation steps.

</details>

Выпуск объединяет исправления экспорта и запуска CapCut с согласованной типографикой, проверенные локально после 1.3.22.

## Скачать

- [**Установщик Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.27/WakuShare-1.3.27-setup-x64.exe) - обычная установка.
- [**Portable Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.27/WakuShare-1.3.27-portable-x64.exe) - запуск без установки, обновление вручную.

## Улучшения и исправления

- **Единая типографика.** Согласованы размеры и начертания кнопок, заголовков, подписей и названий во всех разделах. Основные действия импорта и экспорта получили одинаковые размеры и отступы.
- **Импорт без скачков.** Выбор замены или копии появляется прямо в карточке проекта. Кнопка открытия CapCut сохраняет размер при загрузке; повторные нажатия во время операции заблокированы.
- **Запуск CapCut.** Используется штатный загрузчик и проверяется появление окна редактора. Если загрузчик полностью завершился без окна и процессов, выполняется одна попытка восстановления. Скрытый работающий процесс не перезапускается автоматически.
- **Точнее экспорт.** Отсоединённые сохранённые композиции не вызывают ложные предупреждения. Все временные шкалы и полная актуальная медиатека сохраняются, включая используемые вложенные композиции.
- Отсутствующая служебная обложка проекта больше не считается потерянным исходником. Настоящие недоступные видео, аудио, изображения и шрифты по-прежнему отмечаются предупреждениями. Прогресс рассчитывается по фактическому составу снимка.
- Обновлены чёткие скриншоты интерфейса на русском и английском.

<details>
<summary>Совместимость и технические подробности</summary>

Проверенная сборка: **CapCut International Windows 9.6.0.4097, x64**. Другие версии редактора требуют отдельной проверки. Экспорт сохраняет временные шкалы и медиатеку. Для импорта пресетов закрой CapCut.

Пройдены 324 автоматических теста (8 проверок с отдельным включением пропущены), TypeScript, ESLint, проверка упаковки и точного состава runtime. Перенос копий реальных структур проектов проверен с инертными медиа и сравнением шкал и медиатеки; это не полный перенос многогигабайтных исходников. Запуск CapCut дополнительно проверен с настоящим редактором. Интерфейс проверен на русском и английском, при обычной и узкой ширине, с уменьшением движения. Скриншоты сняты с настоящего интерфейса на демонстрационных данных: PNG в тройной плотности.

Принятые локальные бинарники публикуются без изменения после независимой Windows-проверки CI. Номера 1.3.23-1.3.26 использовались при локальной подготовке. Сборки без цифровой подписи. **Перед запуском нового Portable полностью закрой прежний экземпляр через трей.** Сохраняется обычный профиль настроек WakuShare. Нужен один EXE; контрольные суммы - в `SHA256SUMS.txt`. Runtime-архив, `latest.yml` и `.blockmap` предназначены для сборки и обновлений, вручную устанавливать их не нужно.

</details>

---

Развитие WakuShare / WakuShare development: **WAKUDO Dani** · [Telegram](https://t.me/WAKUDOdani).

Основа / Based on [CapShare by Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.
