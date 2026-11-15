# WakuShare 1.3.33 - Длинные имена файлов при переносе

<details>
<summary><strong>English release notes</strong></summary>

### WakuShare 1.3.33 - Long filenames during transfer

Fixed `Unsafe archive path` when shortening a media filename left a dot at the end. This applies to both project and preset transfers.

### Download

- [**Windows x64 installer**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.33/WakuShare-1.3.33-setup-x64.exe) - regular installation.
- [**Windows x64 Portable**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.33/WakuShare-1.3.33-portable-x64.exe) - no installation, manual updates.

### Fixes

- Generated filenames preserve their extensions, respect component length limits and keep Unicode characters intact. Different files that receive the same short name are assigned separate paths.
- The same filename rules apply when importing media, recording missing sources and suggesting a project package destination.
- Source filenames on disk and CapCut display labels are preserved. Archive validation continues to reject unsafe input paths.

### Verification

Passed 358 automated tests, including project and preset export/import round trips with long Cyrillic names, dots, emoji, collisions, and missing files. These were file based tests. The CapCut sync runtime from 1.3.31 is reused.

Verify downloads with `SHA256SUMS.txt`. Fully exit WakuShare before updating Portable.

</details>

Исправлена ошибка `Unsafe archive path`, которая возникала, когда при сокращении имени медиафайла в конце оставалась точка. Исправление действует при переносе проектов и пресетов.

## Скачать

- [**Установщик Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.33/WakuShare-1.3.33-setup-x64.exe) - обычная установка.
- [**Portable Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.33/WakuShare-1.3.33-portable-x64.exe) - запуск без установки, обновление вручную.

## Исправления

- Сформированные имена сохраняют расширение, укладываются в ограничения длины и не разрезают символы Unicode. Если короткие имена совпадают, разные файлы получают отдельные пути.
- Те же правила действуют при импорте медиа, восстановлении ссылок на отсутствующие исходники и выборе имени пакета в окне сохранения.
- Имена исходников на диске и подписи в CapCut сохраняются. Проверка архива по-прежнему отклоняет небезопасные входные пути.

<details>
<summary>Проверка и технические подробности</summary>

Пройдены 358 автоматических тестов, включая экспорт и обратный импорт проектов и пресетов с длинными кириллическими именами, точками, эмодзи, совпадениями имён и отсутствующими файлами. Проверки проводились на уровне файлов. В выпуске используется модуль синхронизации CapCut из 1.3.31.

Контрольные суммы опубликованы в `SHA256SUMS.txt`. Перед обновлением Portable полностью закрой WakuShare.

</details>

---

WakuShare поддерживает **WAKUDO Dani**. [Telegram](https://t.me/WAKUDOdani)

Основа / Based on [CapShare by Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.
