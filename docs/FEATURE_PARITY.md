# VRCNext Mobile: аудит функций ПК-версии

Исходный проект: [shinyflvre/VRCNext](https://github.com/shinyflvre/VRCNext).
Зафиксированный для аудита коммит: [`0bfb467f89caa21893769f6495abe334febe08a3`](https://github.com/shinyflvre/VRCNext/tree/0bfb467f89caa21893769f6495abe334febe08a3).

VRCNext Mobile — самостоятельная неофициальная мобильная адаптация. Основная
ПК-версия использует .NET 9, Photino.NET, HTML/CSS/JavaScript, SQLite и отдельный
C#-слой VRChat API. Android не запускает этот исполняемый файл: мобильный интерфейс
и нативный сетевой слой создаются отдельно по результатам изучения исходников.

Матрица ниже обновлена по исходникам мобильной версии 0.1.0: `src/App.tsx`,
`src/pages/`, `src/api/` и `android/app/src/main/java/com/diskreid/vrcnextmobile/`.
Это **проверка наличия реализации**, а не подтверждение работы с реальным аккаунтом.
Вход, ответы серверов, изменения аккаунта и взаимодействие с Android/VRChat на
физическом устройстве пока требуют проверки по [плану испытаний](DEVICE_TEST_PLAN.md).
Автоматические проверки с подставленным транспортом не заменяют такую проверку.

Статусы:

- **Реализовано в коде** — есть пользовательский сценарий и вызов API/Android-моста;
  работоспособность с реальным аккаунтом ещё не подтверждена.
- **Частично** — перенесена только указанная часть функции.
- **Только API** — метод есть в библиотеке, но законченного сценария интерфейса нет.
- **Не реализовано** — текущая версия не предоставляет функцию.
- **Нужен ПК** — помимо отсутствующей мобильной реализации нужен доступ к ПК или
  перенос платформенной подсистемы. Companion в версии 0.1.0 отсутствует.

Демонстрационный режим показывает пример интерфейса и блокирует действия,
изменяющие аккаунт. Его данные не являются доказательством работы VRChat API.

## Функции, доступные через VRChat API

Все пути в столбце «Источник» указаны относительно корня исходного VRCNext.

| Раздел / функция оригинала | Источник ПК | Текущий статус мобильной версии | Мобильная реализация |
| --- | --- | --- | --- |
| Вход, восстановление сессии, выход | `Services/VRChatAPI/AuthAPI.cs`, `VRChatApiService.cs` | Реализовано в коде. HTTPS и нативный cookie jar, AES-GCM с Android Keystore, собственный User-Agent; пароль не сохраняется. Нужна проверка входа и восстановления на устройстве. | `src/pages/Auth.tsx`, `src/api/index.ts`, `VrcNativePlugin.java`, `SecureCookieJar.java` |
| Двухфакторная проверка TOTP и Email OTP | `Services/VRChatAPI/AuthAPI.cs` | Реализовано в коде. Выбор предложенного сервером метода и проверка кода; живые TOTP/Email OTP ещё не проверены. | `src/pages/Auth.tsx`, `src/api/index.ts` |
| Несколько аккаунтов и переключение | `main/AuthController.cs`, `frontend/modules/settings/accounts.js` | Не реализовано. Хранится одна текущая сессия; другой аккаунт требует выхода и нового входа. | `src/pages/Auth.tsx`, `SecureCookieJar.java` |
| Статус, текст статуса, местоимения | `Services/VRChatAPI/UsersAPI.cs` | Реализовано в коде: четыре статуса, текст до 32 символов, местоимения. Нужно подтвердить сохранение сервером. | `src/pages/Personal.tsx`, `src/api/index.ts` |
| Биография, языки и социальные ссылки | `Services/VRChatAPI/UsersAPI.cs`, `frontend/modules/user-profile/profile-editor.js` | Реализовано в коде. Биография, коды языков через запятую, ссылки построчно; изменение через `/profile/{self}`. | `src/pages/Personal.tsx`, `src/api/index.ts` |
| Иконка, баннер, темы оформления профиля, значки | `Services/VRChatAPI/UsersAPI.cs`, `InventoryAPI.cs`, `FilesAPI.cs` | Частично: из инвентаря можно применить загруженную/существующую иконку и изображение галереи как баннер, с проверкой VRC+ и подтверждением. Полного редактора тем и значков нет; операции аккаунта не проверены на устройстве. | `src/api/index.ts`, `src/pages/Collections.tsx` |
| Домашний мир | `Services/VRChatAPI/UsersAPI.cs` | Не реализовано: сценария установки homeLocation нет. | — |
| Друзья: онлайн, в игре, web/active, офлайн | `Services/VRChatAPI/FriendsAPI.cs`, `frontend/core/sidebars/friends/friends.js` | Реализовано в коде: загрузка обеих категорий с пагинацией, поиск и фильтры. Друзья не сгруппированы в сворачиваемые секции как в оригинале. | `src/App.tsx`, `src/api/index.ts` |
| Избранные друзья, группы избранного | `Services/VRChatAPI/FavoritesAPI.cs` | Частично: добавить друга в выбранную серверную группу. Отдельной закреплённой секции избранных, перемещения и удаления через интерфейс нет. | `src/pages/Details.tsx`, `src/api/index.ts` |
| Просмотр профиля, доверительный ранг, последние посещения | `Services/VRChatAPI/UsersAPI.cs`, `frontend/core/modals/user-modal/user-modal.js` | Частично: профиль, ранг, статус, местоимения, 18+ отметка, bio, ссылки и местоположение, если открыто. Отдельное отображение last seen не перенесено. | `src/pages/Details.tsx` |
| Поиск людей, заявка в друзья, удаление из друзей | `Services/VRChatAPI/UsersAPI.cs`, `FriendsAPI.cs` | Реализовано в коде: поиск с пагинацией, отправка заявки, подтверждаемое удаление. Нужна проверка на контролируемом тестовом контакте. | `src/App.tsx`, `src/pages/Details.tsx` |
| Заметки о пользователях | `Services/VRChatAPI/UsersAPI.cs` | Реализовано в коде: просмотр и сохранение заметки через `/userNotes`; нужна проверка редактирования, пустого текста и повторного открытия. | `src/pages/Details.tsx`, `src/api/index.ts` |
| Общие друзья и группы | `Services/VRChatAPI/UsersAPI.cs` | Частично: группы пользователя и первая страница общих друзей. Общие группы и полная пагинация mutuals не перенесены. | `src/pages/Details.tsx`, `src/api/index.ts` |
| Блокировка / заглушение и списки модерации | `Services/VRChatAPI/PlayerModerationAPI.cs` | Реализовано в коде: подтверждение block/mute, отдельные списки и обратное действие. Проверка реальных разрешений и результата требуется. | `src/pages/Details.tsx`, `src/pages/Personal.tsx` |
| Boop | `Services/VRChatAPI/UsersAPI.cs` | Не реализовано. | — |
| Панель активности друзей и миров | `frontend/modules/dashboard/dashboard.js`, `Services/VRChatAPI/VRChatWebSocketService.cs` | Частично: друзья и карточки максимум восьми доступных миров; агрегирование по инстансам и подробный список присутствующих друзей не совпадают с ПК-версией. | `src/App.tsx` |
| События друзей и уведомления в реальном времени | `Services/VRChatAPI/VRChatWebSocketService.cs`, `Services/TimelineService.cs` | Реализовано в коде: нативный WebSocket, переподключение, обновление данных и краткая активность. Фоновый сервис Android отсутствует; соединение приостанавливается с приложением. | `src/App.tsx`, `VrcNativePlugin.java` |
| Уведомления V1 / V2, заявки в друзья, приглашения | `Services/VRChatAPI/NotificationsAPI.cs`, `main/NotificationsController.cs` | Частично: объединение V1/V2, разбор JSON-полей, откат при V2 404, список в интерфейсе. Богатые toast-карточки оригинала и все типы действий не перенесены полностью. | `src/App.tsx`, `src/api/index.ts` |
| Принять, скрыть, прочитать уведомление | `Services/VRChatAPI/NotificationsAPI.cs` | Частично: UI принятия friendRequest, group.invite и group.joinRequest, отклонения групповых запросов и скрытия. Прочтение есть только в API, массовой очистки нет. Все действия с реальными уведомлениями требуют проверки. | `src/App.tsx`, `src/api/index.ts` |
| Пригласить друга и запросить приглашение | `Services/VRChatAPI/InviteAPI.cs` | Реализовано в коде. Нужен действительный instance/location; недоступный location отклоняется. | `src/pages/Details.tsx`, `src/api/index.ts` |
| Массовое приглашение | `main/InstanceController.cs`, `frontend/core/modals/friend-invite-modal/friend-invite-modal.js` | Частично: выбор друзей, последовательная отправка с паузой 1,5 секунды и прогрессом. Отмена уже выполняющейся очереди не реализована. | `src/pages/Details.tsx` |
| Ответ на приглашение и приглашение с фото | `Services/VRChatAPI/InviteAPI.cs` | Частично: текстовый ответ через доступный response/requestResponse слот. Приглашения и ответы с фото отсутствуют. | `src/App.tsx`, `src/api/index.ts` |
| Messenger: простые сообщения через приглашения | `Services/VRChatAPI/InviteAPI.cs`, `frontend/core/messenger/messenger.js` | Частично: список друзей, отправка до 60 символов, входящие msg-сообщения, 12 message-шаблонов, повторное использование текста и cooldown. Дополнительный request-пул, история переписки и сохранённая история ПК не перенесены. | `src/pages/Collections.tsx`, `src/api/index.ts` |
| Популярные / активные миры, поиск и пагинация | `Services/VRChatAPI/WorldAPI.cs`, `frontend/modules/worlds/worlds.js` | Реализовано в коде: режимы популярные/активные, поиск по имени/ID, подгрузка страниц. | `src/pages/Explore.tsx`, `src/api/index.ts` |
| Карточка мира: описание, автор, статистика, теги, платформы | `Services/VRChatAPI/WorldAPI.cs`, `frontend/core/modals/world-modal/world-modal.js` | Частично: описание, автор, онлайн, capacity, favorites, теги, PC/Android; посещения и время в мире в карточке не показаны. | `src/pages/Details.tsx`, `src/pages/Explore.tsx` |
| Список инстансов и друзья в мире | `Services/VRChatAPI/WorldAPI.cs`, `InstancesAPI.cs` | Частично: открытые инстансы, число игроков, регион и приглашение себе. Полный состав игроков и список друзей по каждому инстансу не реализованы. | `src/pages/Details.tsx` |
| Собственные загруженные миры | `Services/VRChatAPI/WorldAPI.cs` | Реализовано в коде: режим «Мои миры» и пагинация. | `src/pages/Explore.tsx`, `src/api/index.ts` |
| Редактирование / удаление собственного мира | `Services/VRChatAPI/WorldAPI.cs`, `FilesAPI.cs` | Не реализовано. Просмотр собственных миров не включает изменение или удаление. | — |
| Избранные миры, перенос между группами, переименование групп | `Services/VRChatAPI/FavoritesAPI.cs` | Частично: список избранных, добавление в серверную группу, переименование групп. Перемещения/удаления записей и просмотра содержимого отдельной группы через UI нет. | `src/pages/Explore.tsx`, `src/pages/Details.tsx` |
| Создание обычного инстанса, регион, видимость | `Services/VRChatAPI/InstancesAPI.cs` | Реализовано в коде через POST /instances: Public, Friends+, Friends, Invite/Invite+, EU/US/USE/JP и приглашение себе. Отличается от локального построения location оригинала; нужны живые проверки. | `src/pages/Details.tsx`, `src/api/index.ts` |
| Создание group/group+/group public инстанса | `Services/VRChatAPI/InstancesAPI.cs` | Частично: выбор группы, доступа и региона. Именование, queue, age gate и minimum avatar performance в UI отсутствуют; права проверяет сервер. | `src/pages/Details.tsx`, `src/api/index.ts` |
| Пригласить себя, закрыть инстанс, короткая ссылка | `Services/VRChatAPI/InstancesAPI.cs` | Частично: приглашение себе. Закрытие и получение shortName отсутствуют. | `src/pages/Details.tsx`, `src/api/index.ts` |
| Переход в мир через установленный VRChat | `VRChatApiService.BuildLaunchUri`, `Services/DeepLinkService.cs` | Реализовано в коде: Android ACTION_VIEW с URI vrchat://launch и обработка отсутствующего приложения. Совместимость самого URI с установленным клиентом не проверена. | `VrcNativePlugin.java`, `src/pages/Details.tsx` |
| Мои группы, поиск, вступление, выход | `Services/VRChatAPI/GroupsAPI.cs`, `frontend/modules/groups/groups.js` | Реализовано в коде: мои группы, поиск с пагинацией, вступление и подтверждаемый выход. | `src/pages/Explore.tsx`, `src/api/index.ts` |
| Профиль группы, правила, роли, изображения, представляемая группа | `Services/VRChatAPI/GroupsAPI.cs` | Частично: чтение описания, правил, языков, иконки и баннера. Редактирование, управление ролями и представление группы отсутствуют. | `src/pages/Explore.tsx` |
| Объявления группы и публикации с изображениями | `Services/VRChatAPI/GroupsAPI.cs` | Частично: просмотр и создание публикации с видимостью, флагом уведомления и изображением. Редактирование/удаление в UI отсутствуют; deleteGroupPost есть только в API. | `src/pages/Explore.tsx`, `src/api/index.ts` |
| Участники, роли, заявки, приглашения, баны, журнал аудита | `Services/VRChatAPI/GroupsAPI.cs` | В основном не реализовано. В уведомлениях доступны ответ на group.joinRequest и group.invite; отдельного административного раздела участников, ролей, банов и аудита нет. | `src/api/index.ts` |
| Галереи и активные инстансы группы | `Services/VRChatAPI/GroupsAPI.cs` | Реализовано в коде: выбор галереи, пагинация изображений, список доступных инстансов группы с переходом к миру. | `src/pages/Explore.tsx`, `src/api/index.ts` |
| Создание / удаление группы | `Services/VRChatAPI/GroupsAPI.cs` | Не реализовано. | — |
| Календарь событий: все / избранные / отслеживаемые, выбор месяца | `Services/VRChatAPI/CalendarAPI.cs`, `frontend/modules/calendar/calendar.js` | Частично: календарь, выбор дня/месяца, все/отслеживаемые, подгрузка и локальное время. Фильтр Featured отсутствует. | `src/pages/Collections.tsx`, `src/api/index.ts` |
| Подробности события и подписка на него | `Services/VRChatAPI/CalendarAPI.cs` | Реализовано в коде: карточка события из полученного списка, подписка/отмена и переход к миру. Отдельный API загрузки подробностей есть, но не используется UI. | `src/pages/Collections.tsx`, `src/api/index.ts` |
| Создание / удаление события группы | `Services/VRChatAPI/CalendarAPI.cs` | Не реализовано. | — |
| Собственные аватары, избранные аватары, группы избранного | `Services/VRChatAPI/AvatarsAPI.cs`, `FavoritesAPI.cs` | Частично: собственные/избранные, страницы, поиск среди загруженных карточек, добавление в группу и переименование групп. Перенос/удаление из группы в UI отсутствуют. | `src/pages/Explore.tsx`, `src/api/index.ts` |
| Смена активного аватара | `Services/VRChatAPI/AvatarsAPI.cs` | Реализовано в коде: подтверждение, PUT /avatars/{id}/select, значок текущего. Обновление текущего профиля и Android-совместимость требуют проверки на устройстве. | `src/pages/Explore.tsx`, `src/api/index.ts` |
| Редактирование / удаление своего аватара и галереи | `Services/VRChatAPI/AvatarsAPI.cs`, `FilesAPI.cs` | Не реализовано. | — |
| Поиск публичных аватаров через avtrdb / avtr.icu | `Services/VRChatAPI/AvatarsAPI.cs`, `Services/Avatar Databases/` | Частично: только avtrdb.com, страницы по 20, отдельный нативный HTTP-клиент без VRChat cookie и нормализация ответа. avtr.icu отсутствует. | `src/pages/Explore.tsx`, `src/api/index.ts`, `VrcNativePlugin.java` |
| База db.vrcnext.com, Rose Database, анализ файлов | `Services/VRChatAPI/AvatarsAPI.cs`, `Services/Avatar Databases/VrcndbSigning.cs` | Не реализовано. Приватные signing/build keys оригинального проекта не копируются. | — |
| Фото, галерея, иконки, emoji, sticker | `Services/VRChatAPI/FilesAPI.cs`, `frontend/modules/inventory/inventory.js` | Частично: просмотр, страницы, статическая PNG-загрузка с предпросмотром/обрезкой, VRC+ ограничение UI, удаление, открытие оригинала внешним приложением. Анимированные emoji читаются, но их загрузка, mask/style и отдельное сохранение/шаринг файла не перенесены. | `src/pages/Collections.tsx`, `src/api/index.ts`, `VrcNativePlugin.java` |
| Prints, полученные предметы, украшения профиля | `Services/VRChatAPI/InventoryAPI.cs`, `EconomyAPI.cs` | Частично: просмотр prints/inventory и удаление print. Создание prints, разрешение всех inventory templates и применение украшений профиля отсутствуют. | `src/pages/Collections.tsx`, `src/api/index.ts` |
| Статус по расписанию | `main/StatusScheduleController.cs`, `Services/StatusSchedule/StatusScheduleSettings.cs` | Не реализовано. Фонового Android-планировщика нет. | — |
| Action Flow / автоматизация | `main/ActionFlowController.cs`, `Services/ActionFlow/ActionFlowSettings.cs` | Не реализовано. | — |
| Event Snipe | `main/SnipeController.cs`, `frontend/modules/tools/event-snipe/event-snipe.js` | Не реализовано. | — |
| Permini / расширенные проверки | `frontend/modules/tools/permini/permini.js` | Не реализовано. | — |
| Темы, цвет акцента, язык, настройки и локальный кэш | `frontend/modules/settings/`, `frontend/core/i18n/`, `Services/Helpers/ModalCacheHelper.cs` | Частично: пять цветов акцента, русский интерфейс, локальное сохранение цвета и адреса OSC. Редактора тем, выбора языка, произвольного фона и Fast Fetch/SQLite-кэша оригинала нет. | `src/pages/Personal.tsx`, `src/styles.css`, `src/App.tsx` |

## Функции, зависящие от ПК или локальных данных VRChat

Полное поведение этих функций невозможно перенести на телефон простым изменением интерфейса. Для сохранения
того же поведения необходим отдельный доверенный компонент на ПК, работающий с
локальным VRChat/SteamVR, либо самостоятельная Android-реализация там, где это
технически возможно. Такой компонент в версии 0.1.0 не реализован. Исключение по объёму переноса — ручная отправка OSC-пакетов в локальной сети, описанная ниже.

| Функция оригинала | Источник | Ограничение / статус |
| --- | --- | --- |
| Полный список игроков текущего инстанса | `Services/VRChatAPI/VRChatLogWatcher.cs`, `main/InstanceController.cs` | Не реализовано / нужен ПК. Требуется доступ к журналу игрового клиента на ПК; API не раскрывает полный список произвольного приватного инстанса. |
| История встреч, посещений, фото и сессий | `Services/TimelineService.cs`, `VRChatLogWatcher.cs` | Не реализовано. Вместо ПК-истории есть только журнал текущей мобильной сессии (до 200 записей в памяти, без сохранения), включающий действия клиента и часть событий друзей API. Источник Mobile: `src/App.tsx`, `TimelinePage`. Импорт/синхронизация отсутствуют. |
| Время с людьми / в мирах, Meet Network | `Services/VrcSessionTracker.cs`, `Services/TimelineService.cs` | Не реализовано / нужен ПК. ПК-логи и локальная SQLite; нужны импорт или защищённый companion. |
| Mutual Network | `frontend/modules/tools/mutual-network/` | Не реализовано. Просмотр общих друзей в профиле не является графом Mutual Network; локальная история и закрытые связи недоступны. |
| Media Library: папки VRChat/OBS, метаданные, избранное, рейтинг, теги | `Services/SQLite/MediaLibraryStore.cs`, `main/PhotosController.cs`, `frontend/modules/media-library/` | Не реализовано как локальная медиатека. Раздел «Медиатека» Mobile работает с серверными файлами VRChat и загрузкой выбранного изображения; не сканирует Android/PC папки, не хранит локальные рейтинги/теги/избранное и не импортирует библиотеку ПК. |
| Media Relay: наблюдение за папками и Discord webhooks | `main/RelayController.cs`, `frontend/modules/tools/media-relay/` | Не реализовано / нужен ПК. Windows-only в навигации оригинала. Автоматический перенос фото с ПК требует companion; webhook нельзя публиковать или хранить в открытом виде. |
| Запуск VRChat и приложений SlimeVR/FaceTracking/Standable | `main/MessageRouter.cs`, `Services/Helpers/VrcLaunchPipe.cs` | Запуск Windows `.exe` на Android невозможен. Может быть реализовано удалённое действие через companion. |
| SteamVR Overlay | `Services/SteamAPI/VROverlayService.cs`, `main/VROverlayController.cs` | Не реализовано / нужен ПК. Требует OpenVR/SteamVR на ПК. |
| Space Flight / Space Turn | `main/SpaceFlightController.cs`, `main/SpaceTurnController.cs`, `Services/SteamAPI/` | Не реализовано / нужен ПК. Изменение пространства SteamVR выполняется на ПК, не в Android UI. |
| FrameShot / запись / захват VR | `Services/SteamAPI/FrameShot.cs`, `main/FrameShotController.cs` | Не реализовано / нужен ПК. Требует доступа к VR-композитору/захвату ПК. |
| OSC Tool и управление параметрами аватара | `Services/OscService.cs`, `frontend/modules/tools/osc-tool/` | **Частично реализовано в коде:** ручная отправка Bool/Int/Float/String по известному адресу на LAN IPv4 и UDP-порт. Автообнаружение/OSCQuery, чтение текущих значений и управление набором всех параметров отсутствуют. Источник Mobile: `ToolsPage`, `VrcNativePlugin.java`, `OscPacket.java`. Получение пакета и поведение аватара на ПК ещё не проверены. |
| Custom Chatbox / Chatbox Relay | `Services/ChatboxService.cs`, `main/ChatboxController.cs` | **Частично реализовано в коде:** ручной текст по кнопке на указанный адрес ПК. Ротация, Spotify/iTunes, AFK по фокусу окна, CPU/RAM и время сессии ПК отсутствуют. Источник Mobile: `ToolsPage`, `VrcNativePlugin.java`, `OscPacket.java`; нужны сетевые испытания. |
| Avatar Scaling | `main/AvatarScalingController.cs` | Не реализовано / нужен ПК. Зависит от локального VR/OSC состояния; не является сменой аватара через API. |
| Voice Fight | `Services/VoiceFightService.cs` | Не реализовано / нужен ПК. Оригинал использует Windows VOSK/NAudio; на Android нужны движок распознавания, аудиовывод и разрешение микрофона. |
| Kikitan XD / перевод / озвучка | `Services/KikitanXD/`, `main/KikitanXDController.cs` | Не реализовано / нужен ПК. Windows-зависимые захват звука/локальные модели; удалённые AI-сервисы потребуют собственных пользовательских настроек и отдельной реализации. |
| Discord Rich Presence | `Services/DiscordPresenceService.cs`, `main/DiscordController.cs` | Не реализовано / нужен ПК. Настольный Discord IPC недоступен из Android так же, как на ПК. |
| YouTube Fix / VRCVideoCacher | `frontend/modules/tools/youtube-fix/`, `main/MessageRouter.cs` | Не реализовано / нужен ПК. Требует установки/запуска локального прокси рядом с ПК-клиентом VRChat. |
| Проверка/очистка кэша и конфигурации VRChat на ПК | `Services/Tools/CacheHandler.cs`, `Services/Helpers/VrcConfigHelper.cs` | Не реализовано / нужен ПК. Телефон не имеет доступа к файлам игрового клиента на ПК. |
| Windows autostart, system tray, hotkeys, screen picker | `Services/SystemTrayService.cs`, `Services/Helpers/AutoStartShortcutHelper.cs`, `Services/ScreenColorPickerService.cs` | Не реализовано / нужен ПК. Требуют платформенных аналогов; для мобильного интерфейса нужны Android-механизмы. |

## Контракты API, проверенные по исходникам

Базовый адрес: `https://api.vrchat.cloud/api/1`. Оригинал хранит `auth` и
`twoFactorAuth` в `CookieContainer`, а не использует разработческий API-ключ.

| Область | Контракт оригинала |
| --- | --- |
| Вход | `GET /auth/user`, `Authorization: Basic base64(percentEncode(username) + ':' + percentEncode(password))`. При 2FA сервер возвращает `requiresTwoFactorAuth`. |
| 2FA | `POST /auth/twofactorauth/totp/verify` или `/emailotp/verify`, JSON `{ "code": "..." }`, затем снова `GET /auth/user`. |
| Выход | `PUT /logout`; локальные cookie необходимо удалить независимо от успешности сети. |
| Друзья | `GET /auth/user/friends?offline=false&n=50&offset=...` и такой же запрос с `offline=true`. |
| WebSocket | `wss://pipeline.vrchat.cloud/?authToken=...`, cookie auth/2FA, собственный User-Agent. Типы: `friend-location`, `friend-offline`, `friend-online`, `friend-update`, `friend-active`, `friend-add`, `friend-delete`, `notification`, `notification-v2`, `notification-v2-update`, `notification-v2-delete`, `user-update`. |
| Messenger | `GET /message/{self}/{message\|request}` возвращает слоты `slot`, `message`, `canBeUpdated`, `remainingCooldownMinutes`. `PUT .../{slot}` редактирует текст. Затем обычное приглашение или запрос приглашения с `messageSlot`. |
| Ограничения Messenger | По 12 слотов в пуле `message` и дополнительном пуле `request`, изменение слота ограничивается примерно 60 минутами. В оригинале текст помечается префиксом `msg `. Это не API произвольного личного чата. |
| Ответ Messenger | Пулы `response` / `requestResponse`; `POST /invite/{notificationId}/response` с `responseSlot`. |
| Календарь | `GET /calendar?date=<первый-день-месяца-UTC-ISO>&n=100&offset=...`; отслеживаемые — `/calendar/following`. Ответ: массив или объект с `results`, `events`, `data` либо `items`. |
| Подписка на событие | `POST /calendar/{groupId}/{calendarId}/follow`, JSON `{ "isFollowing": true }` или `false`. |
| События группы | Создание `POST /calendar/{groupId}/event` с `title`, `description`, `startsAt`, `endsAt`, `category`, `accessType`, `sendCreationNotification`, `isDraft: false`, необязательным `imageId`. Удаление `DELETE /calendar/{groupId}/{eventId}`. |
| Изображения инвентаря | `GET /files?tag=<gallery\|icon\|emoji\|sticker>&n=100&offset=...`. Загрузка `POST /file/image` multipart: `tag`, `file`, необязательные `animationStyle`, `maskTag`; удаление `DELETE /file/{fileId}`. |
| Предметы инвентаря | `GET /inventory?n=100&offset=...` возвращает массив либо `{ data, totalCount }`; предмет и его шаблон — разные сущности. |
| Prints | `GET /prints/user/{self}?n=100&offset=...`: массив либо `{prints}` / `{data}`. `POST /prints` multipart `image`, `timestamp`, необязательные `note`, `worldId`, `worldName`. Удаление `DELETE /prints/{printId}`. |

API может измениться независимо от приложения. Ошибки, 401, 403, 429, отсутствие
прав VRC+, истечение сессии и отмена операции должны отображаться явно. Не
повторять изменяющие запросы бесконечно и не считать сетевую ошибку пустым списком.
Данные реального аккаунта должны оставаться отделены от демонстрационного режима.

## Атрибуция и лицензия

Авторство оригинального VRCNext принадлежит VRCNext Contributors; исходный проект
поддерживает shinyflvre и его участники. Оригинал распространяется по собственной
лицензии **VRCNext Non-Commercial Source Available License (VNCOL) 1.3**, а не по
MIT/Apache/GPL. Лицензия требует сохранения copyright, текста лицензии и
атрибуции; коммерческое распространение без разрешения правообладателей не
разрешено. Оригинальный текст должен поставляться с производной версией, включая
APK. В тексте версии 1.3 раздел 3 содержит ссылку на 1.2; это сохранённая
особенность исходной лицензии, а не повод её переписывать.

Раздел 5 лицензии и `README.md` требуют для изменённой версии отдельный
`User-Agent`: собственное имя, версия и действительный контакт сопровождающего.
Нельзя копировать User-Agent официального VRCNext. Для этой адаптации контакт
может указывать на сопровождаемый репозиторий DiskREid/vrcnext-mobile; перед
публикацией сборки следует убедиться, что указанный контакт действителен.

Официальные сервисы подписчика, приватные signing/build keys и User-Agent
оригинального приложения не являются частью автоматически доступных прав или
настроек мобильного форка. Не переносить секреты оригинального проекта.
