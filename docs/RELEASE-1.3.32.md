# WakuShare 1.3.32 - Экспорт проектов с несколькими шкалами

<details>
<summary><strong>English release notes</strong></summary>

### WakuShare 1.3.32 - Multi-timeline project export

Fixed export when CapCut leaves detached timeline folders on disk. The archive keeps all indexed timelines, their names, order and tracks. If a working document still references a timeline missing from the index, export reports the structural error.

### Download

- [**Windows x64 installer**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.32/WakuShare-1.3.32-setup-x64.exe) - regular installation.
- [**Windows x64 Portable**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.32/WakuShare-1.3.32-portable-x64.exe) - no installation, manual updates.

### Verification

Verified an export from CapCut 9.7.1 on Windows. All eight indexed timelines had matching names, order and tracks, and every archive entry passed its CRC check. Automated export/import regressions cover detached and referenced folders. The full 8-timeline project was checked inside the archive. The release reuses the 1.3.31 sync runtime.

Use `SHA256SUMS.txt` to verify the download. Close the running WakuShare instance before updating Portable.

</details>

Исправлен экспорт проектов, в которых CapCut оставил на диске папки отсоединённых шкал. Архив сохраняет все шкалы из индекса, их имена, порядок и дорожки. Если рабочий документ ссылается на шкалу, которой нет в индексе, экспорт сообщает об ошибке структуры.

## Скачать

- [**Установщик Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.32/WakuShare-1.3.32-setup-x64.exe) - обычная установка.
- [**Portable Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.32/WakuShare-1.3.32-portable-x64.exe) - запуск без установки, обновление вручную.

<details>
<summary>Проверка и технические подробности</summary>

Проверен экспорт проекта из CapCut 9.7.1 на Windows. Имена, порядок и дорожки всех восьми шкал совпали, CRC каждой записи архива прошла проверку. Автоматические тесты экспорта и импорта покрывают отсоединённые папки и шкалы со ссылками из проекта. Полный проект с восемью шкалами проверен по содержимому архива. В выпуске используется модуль синхронизации из 1.3.31.

Контрольные суммы опубликованы в `SHA256SUMS.txt`. Перед обновлением Portable полностью закрой запущенный WakuShare.

</details>

---

WakuShare поддерживает **WAKUDO Dani**. [Telegram](https://t.me/WAKUDOdani)

Основа / Based on [CapShare by Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.
