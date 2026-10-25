# Авторизация в VRCNext Mobile 0.2.2

## Исправление Email OTP после0.1.0

В0.1.0 Android-мост отбрасывал session-cookie, если сервер не указал атрибут
`Secure`. Пример ответа в открытой спецификации VRChat содержит `auth` с Path=/
и HttpOnly, но без Secure. Аналогичный пример twoFactorAuth также без Secure.
Поэтому успешная проверка логина/пароля могла показать форму кода, а следующий
запрос без pending auth-cookie получал401. Это подтверждённое несоответствие
кода протоколу, а не доказательство неверного пароля пользователя.

В0.1.1 cookie `auth`/`twoFactorAuth` принимаются только от
`https://api.vrchat.cloud:443`, локально сужаются до точного API-host и получают
Secure/HttpOnly. В HTTP, сторонние хосты и базу аватаров они не отправляются.
Пути, удаление и сроки cookie сохраняются. Шифрование AES-GCM/Android Keystore
остаётся включено; cookie/token не передаются в JavaScript.

Фикстуры и проверки: `SessionCookiesTest.java`. Проверка цепочки действий
клиента и повторного ввода кода: `src/api/api.test.ts`. Тесты не используют
настоящий аккаунт и не доказывают успешный вход конкретного пользователя.

Источники:

- [CurrentUserLoginResponse](https://github.com/vrchatapi/specification/blob/main/openapi/components/responses/authentication/CurrentUserLoginResponse.yaml)
- [Verify2FAEmailCodeResponse](https://github.com/vrchatapi/specification/blob/main/openapi/components/responses/authentication/Verify2FAEmailCodeResponse.yaml)
- [Authentication paths](https://github.com/vrchatapi/specification/blob/main/openapi/components/paths/authentication.yaml)

## Google и другие привязки

У аккаунта VRChat может быть Google-привязка. Но в изученном публичном API
описаны вход данными VRChat и подтверждение email/TOTP/резервным кодом;
документированного прямого Google-входа для этого стороннего клиента не найдено.
Официальные Google client IDs из APIConfig не принадлежат этому приложению и
не используются им. `/oauth/redirectCode` требует уже действующую VRChat-сессию.

Раздел на экране входа открывает официальный https://vrchat.com/home/login
в системном браузере. Вход на сайте не переносит его cookie в Android-мост.
В приложении нужно использовать доступные данные именно аккаунта VRChat,
а не Google-пароль и не отображаемое имя. Привязки/восстановление аккаунта
следует проверять на официальном сайте; неизвестные пути OAuth не подставляются.

- [CurrentUser schema](https://github.com/vrchatapi/specification/blob/main/openapi/components/schemas/CurrentUser.yaml)
- [APIConfig schema](https://github.com/vrchatapi/specification/blob/main/openapi/components/schemas/APIConfig.yaml)

## Первый запуск и диагностика

Если сохранённой auth-cookie нет, форма входа появляется без сетевого запроса.
Если есть pending2FA, клиент восстанавливает запрос кода, сохраняя сессию.
Неверный код не очищает сессию автоматически. Кнопка «Начать вход заново» явно
очищает её локально.

Для разового вылета Tecno Spark20Pro/Android13 HiOS стек исходного сбоя не получен.
0.1.1 сохраняет локально только типы исключений/проверенные имена кадров и метаданные
собственного процесса Android, без сообщений, URL, HTTP, аккаунтных данных и токенов.
Отчёт доступен на экране входа и в настройках. Он не отправляется автоматически.
