# WakuShare 1.3.22 - Папки по проектам и стабильная синхронизация

<details>
<summary><strong>English release notes</strong></summary>

### WakuShare 1.3.22 - Project folders and more reliable sync

This release brings together the improvements tested locally since 1.3.6: project-specific folders, connection editing, sync fixes, and a more polished interface.

### Download

- [**Windows x64 installer**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.22/WakuShare-1.3.22-setup-x64.exe) - regular installation.
- [**Windows x64 Portable**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.22/WakuShare-1.3.22-portable-x64.exe) - no installation; manual updates.

### What's new

- **Folders by project.** A compact searchable project list, additional client folders, and applying a folder set to several projects. Common folders remain active for every project regardless of the selected tab.
- **Edit connections.** Change a label or path, connect a different folder, or declare that the same folder moved. Relocation checks relative paths and file contents, keeps existing clips, and repairs other connected projects when opened. Removing a connection keeps source files, materials, and clips.
- **Complete project media library.** Transfer folders, ordering, custom names, clip links, and media outside the timelines. Export a new package with this version to include a complete library from an older project.
- Open `.wakupresets` packages by double-clicking to preview them in Presets. The installer registers the file type and icon; Portable supports Open with.

### Fixes and interface

- Fixed sync stops while switching projects, handling empty media libraries, and reading saved CapCut documents on different local drives. Replies from the previous project cannot change the new project's state.
- Fixed missing sync components in a running Portable instance after opening the EXE again: each launch now has a separate temporary extraction directory.
- Improved local resource paths during export and import button layout. Ordinary media do not trigger trust prompts; effect resources matching the local CapCut cache exactly do not need repeated confirmation. New or changed active resources still require trust.
- Explorer adds a folder immediately after selection. Connection controls share consistent sizing; opening Presets no longer dims the sidebar, and tab changes no longer jump abruptly.
- The welcome dialog closes smoothly. Its Telegram button reacts to the pointer; the first shine starts after 2 seconds, then repeats every 8 seconds. Reduced motion is respected.

### Compatibility and verification

Tested target: **CapCut International Windows 9.6.0.4097, x64**. Other editor builds require separate testing. Regular export preserves all timelines and the media library; missing source files remain warnings. Close CapCut before importing presets.

287 Node tests passed (8 opt-in tests skipped), with TypeScript, ESLint, package checks and exact runtime payload verification. Earlier native acceptance checked batch import on C: and S:, project preservation after ordinary saving, and explicit folder relocation in the lab. A physical move between volumes was not tested live. Current documentation screenshots use the real renderer with demonstration data, captured as lossless 3x PNGs in Russian and English.

The accepted local 1.3.22 binaries are published unchanged after an independent Windows CI build. Versions 1.3.7-1.3.21 were local preparation stages, not separate public releases. Builds remain unsigned. **Fully exit the previous Portable through the system tray before launching the new EXE.** Settings use the existing WakuShare profile. You need one EXE; checksums are in `SHA256SUMS.txt`. The runtime ZIP, `latest.yml`, and `.blockmap` are build/update resources, not extra manual installation steps.

</details>

Выпуск объединяет доработки, проверенные локально после 1.3.6: папки для клиентов и проектов, редактирование подключений, исправления синхронизации и обновлённый интерфейс.

## Скачать

- [**Установщик Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.22/WakuShare-1.3.22-setup-x64.exe) - обычная установка.
- [**Portable Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.22/WakuShare-1.3.22-portable-x64.exe) - запуск без установки, обновление вручную.

## Что нового

- **Папки по проектам.** Компактный список проектов, поиск, дополнительные папки клиента и применение набора к нескольким проектам. Общие папки продолжают работать со всеми проектами независимо от выбранной вкладки.
- **Редактирование подключений.** Меняй название или путь, подключай другую папку либо указывай, что прежняя папка переехала. Для переезда проверяются относительные пути и содержимое; прежние клипы сохраняются, остальные подключённые проекты восстанавливают пути при открытии. Удаление подключения не удаляет исходники, материалы или клипы.
- **Полная медиатека при переносе проекта.** Сохраняются папки, порядок, ручные названия, связи с клипами и материалы вне временных шкал. Чтобы получить полную библиотеку из старого проекта, экспортируй новый пакет этой версией.
- Пакеты `.wakupresets` открываются двойным кликом в разделе «Пресеты». Ассоциацию и значок добавляет установщик; для Portable доступно «Открыть с помощью».

## Исправления и интерфейс

- Исправлены остановки синхронизации при переключении проектов, пустой медиатеке и чтении сохранённых документов CapCut на разных локальных дисках. Ответы прежнего проекта не меняют состояние нового.
- Исправлена потеря компонентов синхронизации у работающей Portable при повторном запуске EXE: каждый запуск распаковывается в отдельный временный каталог.
- Уточнены локальные пути и ссылки ресурсов при экспорте, исправлено размещение кнопок импорта. Обычные медиа не вызывают запрос доверия; для ресурсов эффектов с точным совпадением в локальном кеше повторное подтверждение не требуется. Для новых или изменённых активных ресурсов запрос сохранён.
- В «Проводнике» папка добавляется сразу после выбора. Выровнены кнопки и редактор подключения, убраны мигания меню при открытии пресетов и резкие скачки вкладок.
- Приветственное окно закрывается плавно. Кнопка Telegram реагирует на движение курсора; первый блик появляется через 2 секунды, последующие - раз в 8 секунд. Учитывается уменьшение движения.

<details>
<summary>Совместимость и технические подробности</summary>

Проверенная сборка: **CapCut International Windows 9.6.0.4097, x64**. Другие версии редактора требуют отдельной проверки. Экспорт сохраняет все временные шкалы и медиатеку; недоступные исходники остаются предупреждениями. Для импорта пресетов закрой CapCut.

Пройдены 287 Node-тестов (8 проверок с отдельным включением пропущены), TypeScript, ESLint, проверка упаковки и точного состава runtime. На предыдущих этапах в редакторе приняты массовый импорт с C: и S:, сохранность проектов после штатного сохранения и явный перенос папки в лаборатории. Физический перенос между дисками в живом редакторе отдельно не проверялся. Скриншоты документации сняты с настоящего интерфейса на демонстрационных данных: PNG в тройной плотности, на русском и английском.

Принятые локальные бинарники 1.3.22 публикуются без пересборки после независимой Windows-сборки CI. Номера 1.3.7-1.3.21 использовались при локальной подготовке и не выпускались отдельно. Сборки без цифровой подписи. **Перед запуском нового Portable полностью закрой прежний экземпляр через трей.** Сохраняется обычный профиль настроек WakuShare. Нужен один EXE; контрольные суммы - в `SHA256SUMS.txt`. Runtime-архив, `latest.yml` и `.blockmap` предназначены для сборки и обновлений, вручную устанавливать их не нужно.

</details>

---

Развитие WakuShare / WakuShare development: **WAKUDO Dani** · [Telegram](https://t.me/WAKUDOdani).

Основа / Based on [CapShare by Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.
