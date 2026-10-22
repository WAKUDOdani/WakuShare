# WakuShare 1.3.6 - Удобное окно экспорта

<details>
<summary><strong>English release notes</strong></summary>

### WakuShare 1.3.6 - A better export dialog

The project preview stays in place and export controls remain accessible, even with many tracks in a small window.

### Download

| Edition                                                                                                                       | Purpose                         |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [**Windows x64 installer**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.6/WakuShare-1.3.6-setup-x64.exe)   | Regular app installation        |
| [**Windows x64 Portable**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.6/WakuShare-1.3.6-portable-x64.exe) | No installation; manual updates |

### Fixed

- The cover keeps its height instead of collapsing as the track list grows. Long project names wrap neatly.
- Project properties and tracks scroll within the dialog. Every track remains accessible.
- Cache options, export, progress, cancel, and the export result remain in the bottom section. There is no need to maximize the app to reach export.
- Long warning lists scroll separately, and track labels have more space.

### Compatibility and technical details

Previously tested editor target: **CapCut International Windows 9.6.0.4097, x64**. This update changes the project dialog layout; project and preset transfer logic and the sync runtime are unchanged.

230 automated tests, TypeScript, ESLint, and package verification passed. The actual renderer was checked in 48 combinations of window size, language, and track count (0–100), including resizing an open dialog. Export controls, progress, cancellation, and long warnings were checked with a mock bridge; this was not a new live CapCut transfer test. The user accepted the local build.

Builds remain unsigned. You only need one EXE; checksums are in `SHA256SUMS.txt`. `Source code` is for developers; `latest.yml` and `.blockmap` serve the updater. Fully exit the old Portable instance through the system tray before launching the new EXE.

---

WakuShare development: **WAKUDO Dani** · [Telegram](https://t.me/WAKUDOdani).

Based on [CapShare by Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.

</details>

Превью проекта остаётся на месте, а экспорт доступен даже при большом количестве дорожек в небольшом окне.

## Скачать

| Вариант                                                                                                                       | Назначение                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [**Установщик Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.6/WakuShare-1.3.6-setup-x64.exe)  | Обычная установка приложения             |
| [**Portable Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.6/WakuShare-1.3.6-portable-x64.exe) | Запуск без установки; обновление вручную |

## Исправления

- Обложка сохраняет высоту при увеличении списка дорожек. Длинные названия проекта аккуратно переносятся.
- Свойства проекта и дорожки прокручиваются внутри окна. Все дорожки остаются доступны.
- Настройка кеша, экспорт, прогресс, отмена и результат закреплены в нижней части. Разворачивать приложение ради кнопки экспорта больше не требуется.
- Длинные списки предупреждений прокручиваются отдельно, под названия дорожек выделено больше места.

<details>
<summary>Совместимость и технические подробности</summary>

Ранее проверенная версия редактора: **CapCut International Windows 9.6.0.4097, x64**. Обновление меняет оформление окна проекта; логика переноса проектов, пресетов и модуль синхронизации не менялись.

230 автоматических тестов, TypeScript, ESLint и проверка упаковки прошли успешно. Настоящий интерфейс проверен в 48 сочетаниях размеров окна, языка и количества дорожек (0–100), включая изменение размера открытого окна. Действия экспорта, прогресс, отмена и длинные предупреждения проверены с имитацией IPC; новый живой перенос в CapCut не проводился. Пользователь принял локальную сборку.

Сборки остаются без цифровой подписи издателя. Для запуска нужен один EXE; контрольные суммы - в `SHA256SUMS.txt`. `Source code` предназначен разработчикам, `latest.yml` и `.blockmap` обслуживают обновления. Перед запуском нового Portable полностью закрой старый экземпляр через трей.

</details>

---

Развитие WakuShare: **WAKUDO Dani** · [Telegram](https://t.me/WAKUDOdani).

Основа - [CapShare от Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.
