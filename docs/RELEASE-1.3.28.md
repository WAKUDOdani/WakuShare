# WakuShare 1.3.28 - Штатные ресурсы пресетов

<details>
<summary><strong>English release notes</strong></summary>

### WakuShare 1.3.28 - Native preset resources

Export and re-export composition presets containing native configuration files without false unsupported-file errors.

### Download

- [**Windows x64 installer**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.28/WakuShare-1.3.28-setup-x64.exe) - regular installation.
- [**Windows x64 Portable**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.28/WakuShare-1.3.28-portable-x64.exe) - no installation; manual updates.

### Fixes

- Fixed “An external reference is not a supported media, font or preset document” when exporting presets with nested-composition configs.
- Native JSON, working templates, and sidecar files inside preset storage and the library resource directory are handled according to directory ownership. Re-exporting previously imported presets preserves their dependencies.
- An external `sub_draft_config.json` is supported in the corresponding nested-composition field and inspected recursively. This does not generally permit reading arbitrary external JSON or text files.
- Original storage-location metadata is distinguished from actual dependencies. Unsupported external-file errors now identify the path; long paths wrap within the error card.
- Executable-content, archive-path, network-reference, and active-resource trust checks remain in place. Filesystem links cannot escape the preset-owned directory; path-resolution results are cached within an operation.

### Compatibility and verification

Tested target: **CapCut International Windows 9.6.0.4097, x64**. Other builds need separate testing. Close CapCut before importing presets.

333 automated tests passed (8 opt-in tests skipped), plus TypeScript, ESLint, package, updater metadata and exact runtime checks. Regression tests include three successive preset export/import cycles, standard media/font/subtitle and native sidecar formats, private-file rejection and escaping junctions. Existing project round trips cover compound configs, smart-crop caches and generated covers.

A read-only inventory covered 796 local JSON documents. Four real presets were exported successfully: all 126 payload files passed size and SHA-256 checks; the source library and its document snapshots were unchanged. This release did not import them into the live library or run native CapCut commands. The runtime and native DLLs remain byte-identical to 1.3.27. Screenshots use the actual renderer with demonstration data, captured as lossless 3x PNGs in both languages.

Accepted local binaries are published unchanged after independent Windows CI verification. Builds remain unsigned. **Fully exit the previous Portable through the system tray before launching the new EXE.** Download one EXE; checksums are in `SHA256SUMS.txt`. The runtime ZIP, `latest.yml`, and `.blockmap` are build/update resources, not additional installation steps.

</details>

Исправлен экспорт и повторный перенос составных пресетов со штатными конфигурационными файлами CapCut.

## Скачать

- [**Установщик Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.28/WakuShare-1.3.28-setup-x64.exe) - обычная установка.
- [**Portable Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.28/WakuShare-1.3.28-portable-x64.exe) - запуск без установки, обновление вручную.

## Исправления

- Исправлена ошибка «Внешняя ссылка ведёт на неподдерживаемый тип файла» при экспорте пресетов с конфигами вложенных композиций.
- Штатные JSON, рабочие шаблоны и вспомогательные файлы внутри папки пресета и ресурсов библиотеки обрабатываются по принадлежности каталогу. Повторный экспорт ранее импортированных пресетов сохраняет их зависимости.
- Внешний `sub_draft_config.json` поддерживается в соответствующем поле вложенной композиции и проверяется вместе с его зависимостями. Это не общее разрешение на чтение любых внешних JSON или текстовых файлов.
- Служебные сведения о прежнем месте хранения отделены от зависимостей. Ошибка неподдерживаемого внешнего файла теперь показывает конкретный путь; длинные строки помещаются в карточку.
- Сохранены проверки исполняемого содержимого, архивных путей, сетевых ссылок и доверия к активным ресурсам. Ссылки файловой системы не могут вывести чтение за пределы принадлежащего пресету каталога; результаты проверки путей кешируются внутри операции.

<details>
<summary>Совместимость и технические подробности</summary>

Проверенная сборка: **CapCut International Windows 9.6.0.4097, x64**. Другие версии требуют отдельной проверки. Для импорта пресетов закрой CapCut.

Пройдены 333 автоматических теста (8 opt-in пропущены), TypeScript, ESLint, проверка упаковки, metadata обновления и точного состава runtime. Регрессионные тесты включают три последовательных export/import цикла, обычные медиа/шрифты/субтитры и native sidecars, запрет приватных файлов и выхода через junction. Существующие project round-trip проверки покрывают конфиги композиций, smart-crop и служебные обложки.

Чтением проверены 796 локальных JSON-документов. Четыре настоящих пресета успешно экспортированы: размеры и SHA-256 всех 126 файлов пакета проверены, исходная библиотека и снимки документов не изменились. В живую библиотеку они на этом этапе не импортировались, нативные команды CapCut не выполнялись. Runtime и нативные DLL побайтово совпадают с 1.3.27. Скриншоты сняты с настоящего renderer на демонстрационных данных, PNG 3x на двух языках.

Принятые локальные бинарники публикуются без изменения после независимой Windows-проверки CI. Сборки без цифровой подписи. **Перед запуском нового Portable полностью закрой прежний экземпляр через трей.** Нужен один EXE; контрольные суммы - в `SHA256SUMS.txt`. Runtime-архив, `latest.yml` и `.blockmap` служат для сборки и обновлений, вручную устанавливать их не нужно.

</details>

---

Развитие WakuShare / WakuShare development: **WAKUDO Dani** · [Telegram](https://t.me/WAKUDOdani).

Основа / Based on [CapShare by Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.
