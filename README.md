# MTProto Service для создания групповых чатов

Простой сервис для создания групповых чатов в Telegram через MTProto API.

## Установка

```bash
npm install
```

## Настройка

Создайте файл `.env`:

```env
TELEGRAM_MANAGER_API_ID=your_api_id
TELEGRAM_MANAGER_API_HASH=your_api_hash
TELEGRAM_MANAGER_PHONE=+1234567890
TELEGRAM_MANAGER_SESSION_STRING=
PORT=3000
```

## Получение API credentials

1. Зайдите на https://my.telegram.org/apps
2. Создайте приложение
3. Скопируйте `api_id` и `api_hash`

## Первый запуск и авторизация

1. Запустите сервис: `npm start`
2. При первом запуске потребуется ввести код из Telegram
3. После авторизации скопируйте `SESSION_STRING` из консоли
4. Добавьте его в `.env` файл
5. Перезапустите сервис

## Запуск

```bash
npm start
```

Сервис будет доступен на `http://localhost:3000`

## API

### POST /create-group

Создает новую группу для объявления.

**Body:**
```json
{
  "listing_id": "uuid",
  "owner_telegram_id": "123456789",
  "renter_telegram_id": "987654321",
  "manager_telegram_id": "111222333",
  "listing_title": "Название объявления"
}
```

**Response:**
```json
{
  "success": true,
  "chat_id": "-1001234567890",
  "chat_title": "Чат #abc12345",
  "invite_link": "https://t.me/joinchat/..."
}
```

## Деплой

Можно задеплоить на:
- Heroku
- Railway
- Render
- VPS сервер
- Docker контейнер

Убедитесь, что переменные окружения установлены на платформе деплоя.

