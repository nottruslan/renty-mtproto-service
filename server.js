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
    console.log('[MTProto] 📥 Received request body:', JSON.stringify(req.body, null, 2));
    
    const { listing_id, owner_telegram_id, renter_telegram_id, manager_telegram_id, listing_title } = req.body;
    
    console.log('[MTProto] 🔍 Extracted parameters:', {
      listing_id: listing_id || 'MISSING',
      owner_telegram_id: owner_telegram_id || 'MISSING',
      renter_telegram_id: renter_telegram_id || 'MISSING',
      manager_telegram_id: manager_telegram_id || 'MISSING',
      listing_title: listing_title || 'MISSING'
    });
    
    // #region agent log
    const fs = require('fs');
    const logPath = '/Users/ru/Downloads/renta-miniapp ver 2.0 — копия 5 изменени раздел редактировать профиль  — тест 1/.cursor/debug.log';
    try {
      const logEntry = JSON.stringify({location:'mtproto-service/server.js:72',message:'MTProto received request body',data:{listing_id,owner_telegram_id,renter_telegram_id,manager_telegram_id,listing_title,rawBody:req.body},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})+'\n';
      fs.appendFileSync(logPath, logEntry);
    } catch (e) {}
    // #endregion
    
    if (!listing_id || !owner_telegram_id || !renter_telegram_id || !manager_telegram_id) {
      console.error('[MTProto] ❌ Missing required parameters:', {
        hasListingId: !!listing_id,
        hasOwnerTelegramId: !!owner_telegram_id,
        hasRenterTelegramId: !!renter_telegram_id,
        hasManagerTelegramId: !!manager_telegram_id
      });
      
      // #region agent log
      try {
        const logEntry2 = JSON.stringify({location:'mtproto-service/server.js:89',message:'MTProto missing parameters',data:{hasListingId:!!listing_id,hasOwnerTelegramId:!!owner_telegram_id,hasRenterTelegramId:!!renter_telegram_id,hasManagerTelegramId:!!manager_telegram_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})+'\n';
        fs.appendFileSync(logPath, logEntry2);
      } catch (e) {}
      // #endregion
      
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
    
    // ✅ ИСПРАВЛЕНО: Используем getInputEntity, который работает даже с неизвестными пользователями
    // getEntity требует, чтобы пользователь был в контактах или кэше
    // Преобразуем строковые ID в числа
    const ownerUserId = parseInt(owner_telegram_id);
    const renterUserId = parseInt(renter_telegram_id);
    const managerUserId = parseInt(manager_telegram_id);
    
    console.log('[MTProto] 🔍 User IDs:', {
      owner: ownerUserId,
      renter: renterUserId,
      manager: managerUserId
    });
    
    // ✅ ИСПРАВЛЕНО: Используем users.getUsers для получения полной информации о пользователях
    // Это работает даже если пользователи не в контактах
    let ownerInput, renterInput, managerInput;
    
    try {
      // Сначала пытаемся получить через users.getUsers с accessHash = 0
      // Telegram вернет правильный accessHash для известных пользователей
      const userIds = [
        new Api.InputUser({ userId: parseInt(owner_telegram_id), accessHash: BigInt(0) }),
        new Api.InputUser({ userId: parseInt(renter_telegram_id), accessHash: BigInt(0) }),
        new Api.InputUser({ userId: parseInt(manager_telegram_id), accessHash: BigInt(0) })
      ];
      
      console.log('[MTProto] 📋 Запрашиваем информацию о пользователях через users.getUsers...');
      
      const usersResult = await client.invoke(
        new Api.users.GetUsers({
          id: userIds
        })
      );
      
      console.log('[MTProto] ✅ Информация о пользователях получена:', usersResult.length, 'пользователей');
      
      // usersResult содержит массив User объектов, из которых создаем InputUser
      ownerInput = new Api.InputUser({ 
        userId: usersResult[0].id, 
        accessHash: usersResult[0].accessHash || BigInt(0) 
      });
      renterInput = new Api.InputUser({ 
        userId: usersResult[1].id, 
        accessHash: usersResult[1].accessHash || BigInt(0) 
      });
      managerInput = new Api.InputUser({ 
        userId: usersResult[2].id, 
        accessHash: usersResult[2].accessHash || BigInt(0) 
      });
      
      console.log('[MTProto] ✅ InputUser объекты созданы для всех участников');
      
    } catch (usersError) {
      console.error('[MTProto] ❌ Ошибка получения информации о пользователях через users.getUsers:', usersError.message);
      // Fallback: пытаемся использовать getEntity (может работать если пользователи в кэше)
      console.log('[MTProto] ⚠️ Используем fallback метод getEntity...');
      try {
        ownerInput = await client.getEntity(owner_telegram_id);
        renterInput = await client.getEntity(renter_telegram_id);
        managerInput = await client.getEntity(manager_telegram_id);
        console.log('[MTProto] ✅ Entity получены через getEntity (fallback)');
      } catch (fallbackError) {
        console.error('[MTProto] ❌ Fallback метод также не сработал:', fallbackError.message);
        throw new Error(`Не удалось получить информацию о пользователях. Проверьте, что все участники (owner, renter, manager) доступны в Telegram и их ID корректны. Ошибка: ${usersError.message}`);
      }
    }
    
    // Создаем группу через messages.createChat
    const groupTitle = `Чат #${listing_id.substring(0, 8)}`;
    
    console.log('[MTProto] 📤 Создание группы с участниками:', {
      title: groupTitle,
      participants: [ownerUserId, renterUserId, managerUserId]
    });
    
    const result = await client.invoke(
      new Api.messages.CreateChat({
        users: [ownerInput, renterInput, managerInput],
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

