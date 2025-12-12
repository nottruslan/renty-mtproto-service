// Простой сервис для создания групповых чатов через MTProto
// Запуск: node server.js
// Использует gramjs для работы с Telegram MTProto API

// Загружаем переменные окружения из .env файла
require('dotenv').config();

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Переменные окружения
const API_ID = parseInt(process.env.TELEGRAM_MANAGER_API_ID || '0');
const API_HASH = process.env.TELEGRAM_MANAGER_API_HASH || '';
const SESSION_STRING = process.env.TELEGRAM_MANAGER_SESSION_STRING || '';
const MANAGER_PHONE = process.env.TELEGRAM_MANAGER_PHONE || '';

if (!API_ID || !API_HASH) {
  console.error('❌ TELEGRAM_MANAGER_API_ID и TELEGRAM_MANAGER_API_HASH должны быть установлены');
  process.exit(1);
}

// Создаем клиент
const stringSession = new StringSession(SESSION_STRING);
const client = new TelegramClient(stringSession, API_ID, API_HASH, {
  connectionRetries: 5,
});

let isClientReady = false;

// Инициализация клиента
async function initClient() {
  if (isClientReady) return;
  
  try {
    console.log('🔌 Подключение к Telegram...');
    await client.connect();
    
    if (!await client.checkAuthorization()) {
      console.error('❌ Требуется авторизация!');
      console.error('📝 Запустите скрипт авторизации: node auth.js');
      console.error('📝 После авторизации сохраните SESSION_STRING в .env файле');
      throw new Error('Требуется авторизация. Запустите: node auth.js');
    }
    
    isClientReady = true;
    console.log('✅ Клиент готов к работе');
    
    // Сохраняем сессию для следующего запуска
    const sessionString = client.session.save();
    if (sessionString !== SESSION_STRING) {
      console.log('💾 Новая сессия. Сохраните это значение в TELEGRAM_MANAGER_SESSION_STRING:');
      console.log(sessionString);
    }
  } catch (error) {
    console.error('❌ Ошибка инициализации клиента:', error.message);
    throw error;
  }
}

// Эндпоинт для создания группы
app.post('/create-group', async (req, res) => {
  try {
    const { listing_id, owner_telegram_id, renter_telegram_id, manager_telegram_id, listing_title } = req.body;
    
    if (!listing_id || !owner_telegram_id || !renter_telegram_id || !manager_telegram_id) {
      return res.status(400).json({ 
        error: 'Missing required parameters: listing_id, owner_telegram_id, renter_telegram_id, manager_telegram_id' 
      });
    }
    
    // Убеждаемся, что клиент готов (инициализируем если нужно)
    if (!isClientReady) {
      console.log('📡 Клиент не готов, инициализируем...');
      await initClient();
    }
    
    console.log(`📦 Создание группы для listing ${listing_id}...`);
    
    // Получаем entities участников
    let ownerEntity, renterEntity, managerEntity;
    try {
      ownerEntity = await client.getEntity(owner_telegram_id);
      renterEntity = await client.getEntity(renter_telegram_id);
      managerEntity = await client.getEntity(manager_telegram_id);
    } catch (entityError) {
      throw new Error(`Не удалось получить информацию об участниках: ${entityError.message}`);
    }
    
    // Создаем группу через messages.createChat
    const groupTitle = `Чат #${listing_id.substring(0, 8)}`;
    
    const result = await client.invoke(
      new Api.messages.CreateChat({
        users: [ownerEntity, renterEntity, managerEntity],
        title: groupTitle
      })
    );
    
    const chatId = result.chats[0].id;
    console.log(`✅ Группа создана: ${chatId}`);
    
    // Отправляем приветственное сообщение
    const botUsername = 'Renta_rent_bot';
    const listingUrl = `https://t.me/${botUsername}?startapp=listing_${listing_id}`;
    // ✅ ИСПРАВЛЕНО: Используем HTML форматирование вместо Markdown (Telegram не поддерживает Markdown в обычных сообщениях)
    const welcomeMessage = `👋 Добро пожаловать в групповой чат по объявлению!\n\n` +
      `📋 <b>${listing_title || 'Объявление'}</b>\n\n` +
      `Участники чата:\n` +
      `• Арендодатель\n` +
      `• Арендатор\n` +
      `• Менеджер Renty\n\n` +
      `🔗 <a href="${listingUrl}">Открыть объявление</a>`;
    
    try {
      await client.sendMessage(chatId, {
        message: welcomeMessage,
        parseMode: 'html' // ✅ Используем HTML парсинг
      });
    } catch (msgError) {
      console.warn('⚠️ Не удалось отправить приветственное сообщение:', msgError.message);
    }
    
    // Получаем invite link
    let inviteLink;
    try {
      const exportResult = await client.invoke(
        new Api.messages.ExportChatInvite({
          peer: chatId
        })
      );
      inviteLink = exportResult.link;
    } catch (inviteError) {
      console.warn('⚠️ Не удалось создать invite link:', inviteError.message);
      // Продолжаем без invite link
    }
    
    res.json({
      success: true,
      chat_id: chatId.toString(),
      chat_title: groupTitle,
      invite_link: inviteLink
    });
    
  } catch (error) {
    console.error('❌ Ошибка создания группы:', error);
    res.status(500).json({
      error: 'Failed to create group',
      message: error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', clientReady: isClientReady });
});

// Root endpoint для проверки
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'renty-mtproto-service',
    clientReady: isClientReady,
    endpoints: {
      health: '/health',
      createGroup: '/create-group'
    }
  });
});

// Запуск сервера
async function start() {
  // Сначала запускаем сервер, чтобы он отвечал на запросы
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервис запущен на порту ${PORT}`);
    console.log(`📡 Эндпоинт: http://0.0.0.0:${PORT}/create-group`);
    console.log(`💚 Health check: http://0.0.0.0:${PORT}/health`);
  });
  
  // Затем инициализируем клиент в фоне (не блокируем запуск)
  initClient().catch((error) => {
    console.error('⚠️ Ошибка инициализации клиента (будет повторена при первом запросе):', error.message);
    // Не завершаем процесс, сервер продолжит работать
  });
}

start();

