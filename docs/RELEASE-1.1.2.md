# WakuShare 1.1.2 - Обновления Portable

Проверка обновлений в Portable открывает страницу актуального выпуска.

> [!NOTE]
> Архивный выпуск. Для обычной установки выбирай [последнюю версию WakuShare](https://github.com/WAKUDOdani/WakuShare/releases/latest).

## Скачать

| Вариант                                                                                                                       | Назначение                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [**Установщик Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.1.2/WakuShare-1.1.2-setup-x64.exe)  | Обычная установка приложения             |
| [**Portable Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.1.2/WakuShare-1.1.2-portable-x64.exe) | Запуск без установки; обновление вручную |

## Исправления

- Кнопка Check for updates в Portable открывает GitHub Releases для ручного скачивания нового EXE.
- Под версией показано пояснение; браузер открывается только по нажатию. Установленная версия сохраняет скачивание и установку через Restart to update.

## Важно

Для Portable 1.1.0/1.1.1 новую переносимую версию сначала нужно скачать вручную. Изменение кнопки доступно начиная с 1.1.2.

<details>
<summary>Совместимость и технические подробности</summary>

Целевая проверенная версия: **CapCut International Windows 9.6.0.4097, x64**.

83 автоматических теста, TypeScript и ESLint. Ядро переноса проектов не менялось.

Для запуска нужен один EXE. `Source code` содержит исходники; `latest.yml`, `.blockmap` и runtime-архивы не нужно скачивать для обычной работы. Контрольные суммы - в `SHA256SUMS.txt` раздела Assets.

</details>

---

Развитие WakuShare: **WAKUDO Dani** · [Telegram](https://t.me/WAKUDOdani).

Основа - [CapShare от Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.
