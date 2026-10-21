# WakuShare 1.3.4 - Безопасность и обновлённый интерфейс

<details>
<summary><strong>English release notes</strong></summary>

### WakuShare 1.3.4 - Security and a refreshed interface

Stronger package transfer protection and a more responsive interface.

### Download

| Edition                                                                                                                       | Purpose                         |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| [**Windows x64 installer**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.4/WakuShare-1.3.4-setup-x64.exe)   | Regular app installation        |
| [**Windows x64 Portable**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.4/WakuShare-1.3.4-portable-x64.exe) | No installation; manual updates |

### Security

- Strengthened archive, path, metadata, reference, and resource integrity checks for project and preset transfers.
- Active effect resources require a trust confirmation, with cancellation as the default. Programs, shortcuts, and system scripts are blocked; ordinary media and automatic sync require no new confirmations.
- Updated Electron and bundled Python/.NET runtimes, and restricted IPC, navigation, and process launch environments.

### Interface

- The sidebar Telegram card now has a cursor-following highlight, a brief shimmer, and icon movement.
- Buttons have softer hover and press feedback. All five menu icons respond again on interaction, including Explorer and the selected section; reduced motion preferences are respected.

### Important

Confirming trust allows effect code to be passed to CapCut; it does not neutralize that code. [Audit details](https://github.com/WAKUDOdani/WakuShare/blob/v1.3.4/docs/security-audit-2026-10-21.md) (Russian).

### Compatibility and technical details

Tested target: **CapCut International Windows 9.6.0.4097, x64**.

230 automated tests, TypeScript, ESLint, package verification, and an independent Windows build. The refreshed runtime passed automated module, ABI, and worker protocol checks; a new live acceptance test of that runtime in CapCut was not repeated. Previously accepted native modules are byte-for-byte unchanged.

You only need one EXE. `Source code` contains the source; `latest.yml`, `.blockmap`, and runtime archives are not needed for normal use. Checksums are in `SHA256SUMS.txt` under Assets.

---

WakuShare development: **WAKUDO Dani** · [Telegram](https://t.me/WAKUDOdani).

Based on [CapShare by Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.

</details>

<!-- Russian release notes -->

Усилена защита переноса пакетов и обновлён отклик интерфейса.

## Скачать

| Вариант                                                                                                                       | Назначение                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [**Установщик Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.4/WakuShare-1.3.4-setup-x64.exe)  | Обычная установка приложения             |
| [**Portable Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.3.4/WakuShare-1.3.4-portable-x64.exe) | Запуск без установки; обновление вручную |

## Безопасность

- Усилены проверки архивов, путей, метаданных, ссылок и целостности ресурсов при переносе проектов и пресетов.
- Активные ресурсы эффектов требуют подтверждения доверия с отменой по умолчанию. Программы, ярлыки и системные сценарии блокируются; обычные медиа и автосинхронизация не требуют новых подтверждений.
- Обновлены Electron и встроенные Python/.NET, ограничены IPC, навигация и окружение запуска процессов.

## Интерфейс

- Карточка Telegram в боковой панели получила подсветку за курсором, короткий блик и движение иконки.
- Кнопки получили мягкое наведение и прожатие. Все пять иконок меню реагируют повторно, включая «Проводник» и выбранный раздел; учитывается уменьшение движения.

## Важно

Подтверждение доверия разрешает передать код эффекта CapCut, но не обезвреживает его. [Подробности аудита](https://github.com/WAKUDOdani/WakuShare/blob/v1.3.4/docs/security-audit-2026-10-21.md).

<details>
<summary>Совместимость и технические подробности</summary>

Целевая проверенная версия: **CapCut International Windows 9.6.0.4097, x64**.

230 автоматических тестов, TypeScript, ESLint, проверки готовых пакетов и независимая Windows-сборка. Новая среда прошла автоматические проверки модулей, ABI и протокола worker; новая живая приёмка среды в CapCut не повторялась. Принятые нативные модули сохранены побайтово.

Для запуска нужен один EXE. `Source code` содержит исходники; `latest.yml`, `.blockmap` и runtime-архивы не нужно скачивать для обычной работы. Контрольные суммы - в `SHA256SUMS.txt` раздела Assets.

</details>

---

Развитие WakuShare: **WAKUDO Dani** · [Telegram](https://t.me/WAKUDOdani).

Основа - [CapShare от Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.
