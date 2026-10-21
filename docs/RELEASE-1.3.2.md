# WakuShare 1.3.2 - Проводник и автосинхронизация

<details>
<summary><strong>English release notes</strong></summary>

### WakuShare 1.3.2 - Explorer and automatic sync

Windows folders automatically appear in the media library of new and existing CapCut projects.

> [!NOTE]
> Archived release. For a regular installation, choose the [latest WakuShare version](https://github.com/WAKUDOdani/WakuShare/releases/latest).

### Download

| Edition                                                                                                                       | Purpose                         |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [**Windows x64 installer**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.2/WakuShare-1.3.2-setup-x64.exe)   | Regular app installation        |
| [**Windows x64 Portable**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.2/WakuShare-1.3.2-portable-x64.exe) | No installation; manual updates |

### What's new

- Explorer: shared folder connections or folders for one project, preserving nested folder structure.
- Event-driven sync, bulk import as a single list, and confirmed progress; media references are preserved when sources are renamed or moved.
- Project export to `.wakushare`, with continued support for importing older `.capshare` packages.

### Improvements

- Preset spacing, navigation, and selection are aligned; neutral glass hover feedback replaces purple outlines.
- Dark buttons are easier to see on transparent backgrounds; light buttons stay bright on hover. The version appears under the app name.

### Important

Windows may lock files used on the timeline: leave the CapCut project before renaming or moving them.

### Compatibility and technical details

Tested target: **CapCut International Windows 9.6.0.4097, x64**.

The sync worker and runtimes are already included in the EXE. The separate WakuShare-explorer-runtime-1.3.2-win-x64.zip is for building from source and is not needed to run the app.

You only need one EXE. `Source code` contains the source; `latest.yml`, `.blockmap`, and runtime archives are not needed for normal use. Checksums are in `SHA256SUMS.txt` under Assets.

---

WakuShare development: **WAKUDO Dani** · [Telegram](https://t.me/WAKUDOdani).

Based on [CapShare by Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.

</details>

<!-- Russian release notes -->

Папки Windows автоматически появляются в медиатеке новых и существующих проектов CapCut.

> [!NOTE]
> Архивный выпуск. Для обычной установки выбирай [последнюю версию WakuShare](https://github.com/WAKUDOdani/WakuShare/releases/latest).

## Скачать

| Вариант                                                                                                                       | Назначение                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [**Установщик Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.2/WakuShare-1.3.2-setup-x64.exe)  | Обычная установка приложения             |
| [**Portable Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.2/WakuShare-1.3.2-portable-x64.exe) | Запуск без установки; обновление вручную |

## Что нового

- Раздел «Проводник»: общие подключения или папки для одного проекта, с сохранением вложенности.
- Синхронизация по событиям, массовый импорт одним списком и подтверждённый прогресс; сохранение привязок при переименовании и переносе источников.
- Экспорт проектов в `.wakushare` с сохранением импорта прежних `.capshare`.

## Улучшения

- В пресетах выровнены отступы, навигация и выбор; нейтральное стеклянное наведение заменяет фиолетовые рамки.
- Тёмные кнопки лучше видны на прозрачном фоне, светлые сохраняют яркость при наведении. Версия показана под названием приложения.

## Важно

Windows может удерживать используемые на таймлайне файлы: для переименования или переноса сначала выйди из проекта CapCut.

<details>
<summary>Совместимость и технические подробности</summary>

Целевая проверенная версия: **CapCut International Windows 9.6.0.4097, x64**.

Модуль синхронизации и среды запуска уже включены в EXE. Отдельный WakuShare-explorer-runtime-1.3.2-win-x64.zip предназначен для сборки из исходников, для обычного запуска он не нужен.

Для запуска нужен один EXE. `Source code` содержит исходники; `latest.yml`, `.blockmap` и runtime-архивы не нужно скачивать для обычной работы. Контрольные суммы - в `SHA256SUMS.txt` раздела Assets.

</details>

---

Развитие WakuShare: **WAKUDO Dani** · [Telegram](https://t.me/WAKUDOdani).

Основа - [CapShare от Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.
