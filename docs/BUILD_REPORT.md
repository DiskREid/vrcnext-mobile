# Проверка сборки 0.1.0

Собран тестовый APK `artifacts/VRCNext-Mobile-0.1.0.apk`.
Размер: 4,510,574 байт. Пакет: `com.diskreid.vrcnextmobile`.
Минимальная ОС: Android8/API26, актуальный System WebView109+; target API35.
Подпись APK Signature Scheme v2 проверена `apksigner`. Это debug-сборка.

SHA256: `af6c05e263629a4213dcdb8d6905b054570f6134600873245c6e1cb0608aa777`

| Проверка | Результат |
|---|---|
| Установка по lockfile `npm ci` | Прошла |
| TypeScript + production Vite build | Прошли |
| Vitest API-контрактов | 26 прошли, 0 ошибок, 0 пропусков |
| JUnit нативных URL/OSC/image validators | 11 прошли, 0 ошибок, 0 пропусков |
| Playwright Chromium | 6 прошли: 390×844 и 844×390, включая поворот с открытым миром |
| Android Lint Debug | 0 ошибок, 6 предупреждений (ApplySharedPref, ObsoleteSdkInt, UnusedResources) |
| `:app:assembleDebug` | Прошла |
| Состав APK | Web assets совпадают с последним `dist`; внешний dev-server отсутствует |
| Нативные логи/WebView debugging | Отключены в упакованной конфигурации |

JUnit проверяет протоколы и валидацию; работу Bitmap/Keystore он не исполняет.
Playwright проверяет явный браузерный деморежим, а не VRChat-сессию.
Снимки интерфейса находятся в `artifacts/screenshots` и не доказывают работу API.

## Непроверенное

APK не запускался на физическом Android или эмуляторе. Реальный вход/2FA,
сохранение Keystore, account REST/WebSocket, загрузка защищённых изображений,
изменение размера картинок на Android, инвентарь/VRC+, права групп,
переход в установленный VRChat и получение OSC на ПК требуют проверки.
Сценарии: [DEVICE_TEST_PLAN.md](DEVICE_TEST_PLAN.md).

Облачные обращения к api.vrchat.cloud и api.avtrdb.com получили CONNECT403
от egress-прокси. Домены и инструкции install_script/start_skill сохранены в
черновике настроек; сохранение черновика не применяет сетевые изменения и не
публикует снимок. Новая задача после публикации ещё не проверялась.
Телефон использует собственную сеть, независимо от облачного egress.

## Состояние исходников

Мобильный проект создан в `/workspace/vrcnext-mobile`, который ранее был пуст.
Для размещения в GitHub подготовлен каталог `releases/v0.1.0`: APK, архив
исходников, контрольные суммы и снимки интерфейса. Исходники упакованы в ZIP без
node_modules, SDK/JDK, приватных ключей подписи, .git и кешей.
Полного паритета с ПК нет: [FEATURE_PARITY.md](FEATURE_PARITY.md).
