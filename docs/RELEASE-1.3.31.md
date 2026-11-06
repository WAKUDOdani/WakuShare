# WakuShare 1.3.31 - CapCut 9.7 и понятная автосинхронизация

<details>
<summary><strong>English release notes</strong></summary>

### WakuShare 1.3.31 - CapCut 9.7 and clearer auto-sync

Auto-sync now works with the tested CapCut 9.7 build, reports specific failures, and includes fixes for timeline import, launching the editor and the tray.

### Download

- [**Windows x64 installer**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.31/WakuShare-1.3.31-setup-x64.exe) - regular installation.
- [**Windows x64 Portable**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.31/WakuShare-1.3.31-portable-x64.exe) - no installation; manual updates.

### Improvements and fixes

- Auto-sync connects to CapCut 9.7 without a fixed build-number gate: it checks the interfaces required for each operation.
- Errors identify the operation and reason: connection, library reading, adding files, folders, renaming, moving, removing or restoring media cards. A library-list refresh failure is shown separately from the verified write result.
- Fixed sync with projects containing multiple timelines. Accepted checks cover adding files, nested folders, rename and move, a new file at an old path, removing an unused missing card, and restoring a returned file.
- Project import verifies the saved index of all timelines and requires CapCut to be closed; editor state is checked again before registering the project.
- Fixed launching CapCut after import on a fresh Windows installation. One direct-editor fallback is allowed after the bootstrapper is confirmed to have exited without descendants.
- Fixed tray creation and restoring the hidden window: the icon is created at startup and retained when sync is paused or disconnected; one click or a second launch opens the window.
- Refreshed screenshots and user guides in Russian and English.

### Important

Live acceptance target: **CapCut International Windows 9.7.1.4203, x64 on Windows 11**. The adapter checks interfaces instead of trusting the version number. This does not guarantee compatibility with every future private API change. This adapter requires Qt ABI 6.2.2; mismatches are reported. Windows 10 and this new adapter on CapCut 9.6 were not live-tested in this release.

Close CapCut before importing projects or presets. **Fully exit the previous WakuShare through its tray menu before updating Portable.** Used missing sources remain CapCut's missing media. If safe ownership across timelines cannot be established, the affected relink is paused with a specific error. Commands whose completion is unknown are not automatically replayed. If only the library-list refresh is unconfirmed, reopen the project as instructed by the warning.

<details>
<summary>Compatibility and technical details</summary>

353 application tests passed (8 opt-in tests skipped), plus TypeScript, ESLint, 69 adaptive-helper tests and 188 managed transition checks. Native builds, path/equivalence checks, a hardware-fault boundary control, Qt observer churn tests, runtime integrity, package and update metadata checks passed. Independent Windows CI verifies the exact tagged application source before publication; the accepted local installer and Portable bytes are retained.

Live tests used a separate 13-timeline project and copied media fixtures. Timeline tracks were unchanged during the accepted sync operations. After normal close/reopen, all 13 timelines and the three initial PNGs were confirmed; CapCut normalized 805 `rotation3d` values from null to an empty array and numeric JSON formatting. No other semantic track changes were found in that comparison. The installed 1.3.31 was separately accepted on a small 13-empty-timeline fixture with three PNGs and no connection error. Launch, tray return and full project imports were accepted during the preceding local stage.

New native modules are provided in a separately indexed runtime; frozen `runtime-src` is preserved and current source/build notes are in `runtime-adaptive`. Only the interfaces needed by an operation are required. A delivered import can finish verification by reading saved state; it is never re-imported as a recovery guess. Uncertain optional view refresh is recorded separately and is not replayed.

Builds remain unsigned. Download one EXE; `SHA256SUMS.txt` verifies release-file bytes. `latest.yml`, `.blockmap`, `package-verification.json` and the runtime ZIP are update/build resources, not extra installation steps. README screenshots use the actual renderer with synthetic demonstration data, captured as lossless 3x PNGs in both languages; they are not live CapCut evidence.

</details>

</details>

Автосинхронизация работает с проверенной сборкой CapCut 9.7, сообщает конкретные причины сбоев и включает исправления импорта шкал, запуска редактора и трея.

## Скачать

- [**Установщик Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.31/WakuShare-1.3.31-setup-x64.exe) - обычная установка.
- [**Portable Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.31/WakuShare-1.3.31-portable-x64.exe) - запуск без установки, обновление вручную.

## Улучшения и исправления

- Автосинхронизация подключается к CapCut 9.7 без жёсткой привязки к номеру сборки: проверяются интерфейсы, необходимые для конкретного действия.
- Ошибки показывают операцию и причину: подключение, чтение медиатеки, добавление, папки, переименование, перенос, удаление или восстановление. Сбой обновления списка медиатеки отображается отдельно от результата записи.
- Исправлена работа синхронизации с проектами, содержащими несколько временных шкал. Проверены добавление файлов, вложенные папки, переименование и перенос, новый файл по прежнему пути, удаление неиспользуемой отсутствующей карточки и восстановление.
- Импорт проверяет сохранённый индекс всех временных шкал и требует закрытого CapCut; перед добавлением проекта состояние редактора проверяется повторно.
- Исправлен запуск CapCut после импорта при свежей установке Windows. После подтверждённого выхода загрузчика без дочерних процессов допускается одна попытка запуска установленного редактора.
- Исправлены создание значка трея и возврат скрытого окна: значок появляется при запуске, сохраняется при паузе синхронизации и ошибках подключения; один клик или повторный запуск открывает окно.
- Обновлены скриншоты и инструкция на русском и английском.

## Важно

Живая приёмка: **CapCut International Windows 9.7.1.4203, x64 на Windows 11**. Адаптер проверяет интерфейсы, а не доверяет номеру версии. Это не гарантирует работу с любыми будущими изменениями частных API. Текущий адаптер требует ABI Qt 6.2.2; несовпадение показывается явно. Windows 10 и новый адаптер на CapCut 9.6 в этом выпуске вживую не проверялись.

Перед импортом проектов и пресетов закрой CapCut. **Перед обновлением Portable полностью выйди из прежнего WakuShare через меню трея.** Используемые отсутствующие исходники остаются потерянным медиа CapCut. Если нельзя доказать безопасную принадлежность материала в нескольких шкалах, соответствующая перепривязка приостанавливается с конкретной ошибкой. Команды с неизвестным результатом автоматически не повторяются. Если не подтверждено только обновление списка медиатеки, переоткрой проект по подсказке предупреждения.

<details>
<summary>Совместимость и технические подробности</summary>

Пройдены 353 теста приложения (8 opt-in пропущены), TypeScript, ESLint, 69 тестов адаптивных helpers и 188 проверок переходов managed-worker. Пройдены нативная сборка, проверки путей и эквивалентности документов, контроль перехвата аппаратной ошибки, тесты наблюдателя Qt, целостности runtime, упаковки и metadata обновлений. Независимая Windows CI проверяет точные исходники тега перед публикацией; принятые локальные байты установщика и Portable сохраняются.

Живые проверки выполнялись на отдельном проекте с 13 шкалами и копиях тестовых исходников. Во время принятых операций синхронизации дорожки не изменились. После штатного выхода и повторного открытия подтверждены все 13 шкал и три исходных PNG; CapCut нормализовал 805 значений `rotation3d` из null в пустой массив и числовое представление JSON. Других семантических изменений дорожек при сравнении не найдено. Установленная 1.3.31 отдельно принята на маленьком проекте с 13 пустыми шкалами и тремя PNG без ошибки подключения. Запуск, возврат из трея и полный импорт проектов приняты на предыдущем локальном этапе.

Новые нативные модули поставляются отдельным индексированным runtime; замороженный `runtime-src` сохранён, актуальные исходники и сборка описаны в `runtime-adaptive`. Для действия требуются только относящиеся к нему интерфейсы. Проверка уже доставленного импорта может завершиться чтением сохранённого состояния, без повторного импорта наугад. Неопределённое обновление списка медиатеки учитывается отдельно и не повторяется.

Сборки без цифровой подписи. Нужен один EXE; `SHA256SUMS.txt` позволяет сверить байты файлов. `latest.yml`, `.blockmap`, `package-verification.json` и runtime-архив обслуживают обновления и сборку, вручную устанавливать их не нужно. Скриншоты README сняты с настоящего renderer на синтетических демонстрационных данных, PNG 3x на двух языках; это не доказательство живой работы CapCut.

</details>

---

Развитие WakuShare / WakuShare development: **WAKUDO Dani** · [Telegram](https://t.me/WAKUDOdani).

Основа / Based on [CapShare by Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.
