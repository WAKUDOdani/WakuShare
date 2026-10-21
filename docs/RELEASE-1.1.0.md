# WakuShare 1.1.0 - Первый выпуск WakuShare

Независимая версия CapShare для переноса и резервного копирования проектов CapCut.

> [!NOTE]
> Архивный выпуск. Для обычной установки выбирай [последнюю версию WakuShare](https://github.com/WAKUDOdani/WakuShare/releases/latest).

## Скачать

| Вариант                                                                                                                       | Назначение                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [**Установщик Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.1.0/WakuShare-1.1.0-setup-x64.exe)  | Обычная установка приложения             |
| [**Portable Windows x64**](https://github.com/WAKUDOdani/WakuShare/releases/download/v1.1.0/WakuShare-1.1.0-portable-x64.exe) | Запуск без установки; обновление вручную |

## Что нового

- Согласованный перенос нескольких временных шкал, их идентификаторов, каталогов и раскладки.
- Сбор исходников из дополнительных шкал и вложенных композиций. Размещение пользовательских медиа в `Resources/local/Исходники` с рабочими ссылками.
- Проверка размеров, SHA-256 и самостоятельности новой копии. Собственный канал обновлений WakuShare и ссылка на Telegram.

## Важно

Первый выпуск на основе CapShare 1.0.2 от Ilyasse Salama. Сохранены история upstream и MIT-лицензия. Настройки и отображение обновлений дополнительно доработаны в 1.1.1.

<details>
<summary>Совместимость и технические подробности</summary>

Целевая проверенная версия: **CapCut International Windows 9.6.0.4097, x64**.

Проверен CapCut International Windows 9.6.0.4097. Установка и запуск этого выпуска подтверждены пользователем. Сборки без цифровой подписи издателя Windows.

Для запуска нужен один EXE. `Source code` содержит исходники; `latest.yml`, `.blockmap` и runtime-архивы не нужно скачивать для обычной работы. Контрольные суммы - в `SHA256SUMS.txt` раздела Assets.

</details>

---

Развитие WakuShare: **WAKUDO Dani** · [Telegram](https://t.me/WAKUDOdani).

Основа - [CapShare от Ilyasse Salama](https://github.com/ilyassesalama/CapShare), MIT.
