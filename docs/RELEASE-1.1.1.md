# WakuShare 1.1.1 - Исправления интерфейса и обновлений

Уточнены авторство, отображение версии и сообщения обновления.

> [!NOTE]
> Архивный выпуск. Для обычной установки выбирай [последнюю версию WakuShare](https://github.com/WAKUDOdani/WakuShare/releases/latest).

## Скачать

| Вариант                                                                                                                       | Назначение                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [**Установщик Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.1.1/WakuShare-1.1.1-setup-x64.exe)  | Обычная установка приложения             |
| [**Portable Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.1.1/WakuShare-1.1.1-portable-x64.exe) | Запуск без установки; обновление вручную |

## Исправления

- Подпись автора изменена на WakuShare by WAKUDO Dani.
- Номер версии остаётся виден при проверке обновлений и ошибке сети.
- В настройках убрана поясняющая строка, прокрутка начинается ниже заголовка.
- Пустая лента релизов обрабатывается понятным сообщением вместо технической ошибки разбора.

## Важно

Установленная 1.1.0 обновляется через Settings → Check for updates → Restart to update. Portable обновляется вручную.

<details>
<summary>Совместимость и технические подробности</summary>

Целевая проверенная версия: **CapCut International Windows 9.6.0.4097, x64**.

80 автоматических тестов, TypeScript и ESLint. Ядро переноса проектов не менялось.

Для запуска нужен один EXE. `Source code` содержит исходники; `latest.yml`, `.blockmap` и runtime-архивы не нужно скачивать для обычной работы. Контрольные суммы - в `SHA256SUMS.txt` раздела Assets.

</details>

---

Развитие WakuShare: **WAKUDO Dani** · [Telegram](https://t.me/WAKUDOdani).

Основа - [CapShare от Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.
