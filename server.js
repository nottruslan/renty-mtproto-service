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
    
    const { listing_id, owner_telegram_id, renter_telegram_id, manager_telegram_id, listing_title, owner_telegram_username, renter_telegram_username } = req.body;
    
    console.log('[MTProto] 🔍 Extracted parameters:', {
      listing_id: listing_id || 'MISSING',
      owner_telegram_id: owner_telegram_id || 'MISSING',
      renter_telegram_id: renter_telegram_id || 'MISSING',
      manager_telegram_id: manager_telegram_id || 'MISSING',
      listing_title: listing_title || 'MISSING',
      owner_telegram_username: owner_telegram_username || 'N/A',
      renter_telegram_username: renter_telegram_username || 'N/A'
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
    
    // ✅ ИСПРАВЛЕНО: Используем getInputEntity, который более надежен для получения InputUser
    // getInputEntity возвращает InputPeer, который можно преобразовать в InputUser для CreateChat
    let ownerInput, renterInput, managerInput;
    
    async function getUserInputForChat(telegramId, role) {
      try {
        // getInputEntity возвращает InputPeer, который содержит userId и accessHash
        const inputPeer = await client.getInputEntity(telegramId);
        console.log(`[MTProto] ✅ ${role} InputPeer получен:`, {
          className: inputPeer.className,
          userId: inputPeer.userId ? inputPeer.userId.toString() : 'N/A'
        });
        
        if (inputPeer instanceof Api.InputPeerUser) {
          // Преобразуем InputPeerUser в InputUser для CreateChat
          return new Api.InputUser({ 
            userId: inputPeer.userId, 
            accessHash: inputPeer.accessHash 
          });
        } else if (inputPeer instanceof Api.InputPeerSelf) {
          // Если это сам менеджер (self), получаем информацию о себе
          console.log(`[MTProto] ℹ️ ${role} является self, получаем информацию о себе...`);
          const me = await client.getMe();
          return new Api.InputUser({ 
            userId: me.id, 
            accessHash: me.accessHash || BigInt(0) 
          });
        } else {
          throw new Error(`${role} entity не является пользователем (className: ${inputPeer.className})`);
        }
      } catch (error) {
        console.error(`[MTProto] ❌ Ошибка получения ${role} entity:`, error.message);
        // Если getInputEntity не работает, нужно получить accessHash через users.getUsers
        const userId = parseInt(telegramId);
        console.log(`[MTProto] ⚠️ Пробуем использовать users.getUsers для ${role} с userId=${userId}`);
        
        try {
          // Пытаемся получить accessHash через users.getUsers
          const usersResult = await client.invoke(
            new Api.users.GetUsers({
              id: [new Api.InputUser({ userId: userId, accessHash: BigInt(0) })]
            })
          );
          
          if (usersResult && Array.isArray(usersResult) && usersResult.length > 0 && usersResult[0] && usersResult[0].id) {
            const user = usersResult[0];
            console.log(`[MTProto] ✅ ${role} получен через users.getUsers`);
            return new Api.InputUser({ 
              userId: user.id, 
              accessHash: user.accessHash || BigInt(0) 
            });
          } else {
            console.log(`[MTProto] ⚠️ users.getUsers для ${role} вернул неожиданный результат:`, usersResult);
          }
        } catch (usersError) {
          console.error(`[MTProto] ❌ users.getUsers также не сработал для ${role}:`, usersError.message);
        }
        
        // Последний fallback - используем userId напрямую (может не сработать)
        console.log(`[MTProto] ⚠️ Используем InputUser с accessHash=0 для ${role} (последний fallback)`);
        return new Api.InputUser({ userId: userId, accessHash: BigInt(0) });
      }
    }
    
    try {
      ownerInput = await getUserInputForChat(owner_telegram_id, 'Owner');
      renterInput = await getUserInputForChat(renter_telegram_id, 'Renter');
      managerInput = await getUserInputForChat(manager_telegram_id, 'Manager');
      
      console.log('[MTProto] ✅ Все InputUser объекты получены для создания группы');
    } catch (error) {
      console.error('[MTProto] ❌ Критическая ошибка при получении InputUser:', error.message);
      throw new Error(`Не удалось получить информацию о пользователях: ${error.message}`);
    }
    
    // Создаем группу через messages.createChat
    const groupTitle = `Чат #${listing_id.substring(0, 8)}`;
    
    console.log('[MTProto] 📤 Создание группы с участниками:', {
      title: groupTitle,
      ownerInput: { userId: ownerInput.userId.toString(), accessHash: ownerInput.accessHash.toString() },
      renterInput: { userId: renterInput.userId.toString(), accessHash: renterInput.accessHash.toString() },
      managerInput: { userId: managerInput.userId.toString(), accessHash: managerInput.accessHash.toString() }
    });
    
    console.log('[MTProto] 📤 Вызов messages.CreateChat...');
    const result = await client.invoke(
      new Api.messages.CreateChat({
        users: [ownerInput, renterInput, managerInput],
        title: groupTitle
      })
    );
    
    console.log('[MTProto] 📋 Результат CreateChat:', {
      type: typeof result,
      className: result?.className,
      hasUpdates: !!result?.updates,
      hasChats: !!result?.updates?.chats,
      chatsLength: result?.updates?.chats?.length
    });
    
    // ✅ ИСПРАВЛЕНО: messages.InvitedUsers возвращает chats в result.updates.chats
    let chatId;
    if (result && result.updates && result.updates.chats && result.updates.chats.length > 0) {
      chatId = result.updates.chats[0].id;
      console.log(`[MTProto] ✅ Группа создана, chatId: ${chatId}`);
    } else if (result && result.chats && result.chats.length > 0) {
      // Fallback для другого формата ответа
      chatId = result.chats[0].id;
      console.log(`[MTProto] ✅ Группа создана (fallback), chatId: ${chatId}`);
    } else {
      throw new Error(`CreateChat вернул неожиданный результат, не удалось найти chatId. Структура: ${JSON.stringify(result, null, 2)}`);
    }
    
    // Преобразуем chatId в число (может быть BigInt или строка)
    const chatIdNumber = typeof chatId === 'bigint' ? Number(chatId) : parseInt(chatId.toString());
    
    // Создаем InputPeerChat для использования в API вызовах
    const chatPeer = new Api.InputPeerChat({ chatId: chatIdNumber });
    
    // ✅ НОВОЕ: Включаем видимость истории чата для новых участников
    // Примечание: CHAT_NOT_MODIFIED означает что права уже настроены правильно, это нормально
    try {
      console.log('[MTProto] 🔧 Настраиваем видимость истории чата...');
      const historyResult = await client.invoke(
        new Api.messages.EditChatDefaultBannedRights({
          peer: chatPeer,
          bannedRights: new Api.ChatBannedRights({
            viewMessages: false, // разрешить просмотр истории сообщений
            sendMessages: false,
            sendMedia: false,
            sendStickers: false,
            sendGifs: false,
            sendGames: false,
            sendInline: false,
            embedLinks: false,
            sendPolls: false,
            changeInfo: false,
            inviteUsers: false,
            pinMessages: false,
            manageTopics: false,
            sendPhotos: false,
            sendVideos: false,
            sendRoundvideos: false,
            sendAudios: false,
            sendVoices: false,
            sendDocs: false,
            sendPlain: false,
            untilDate: 0
          })
        })
      );
      console.log('[MTProto] ✅ История чата настроена, результат:', JSON.stringify(historyResult, null, 2));
    } catch (historyError) {
      // CHAT_NOT_MODIFIED - это нормально, означает что права уже такие
      if (historyError.message && historyError.message.includes('CHAT_NOT_MODIFIED')) {
        console.log('[MTProto] ℹ️ История чата уже настроена правильно (CHAT_NOT_MODIFIED)');
      } else {
        console.warn('[MTProto] ⚠️ Не удалось настроить видимость истории чата:', historyError.message);
      }
    }
    
    // ✅ НОВОЕ: Пытаемся получить accessHash из результата CreateChat
    // Telegram возвращает информацию о пользователях в result.updates.users
    const usersFromCreateChat = result?.updates?.users || [];
    console.log('[MTProto] 🔍 Пользователи из CreateChat:', usersFromCreateChat.length, 'пользователей');
    
    // Создаем мапу userId -> User для быстрого доступа
    const usersMap = new Map();
    if (Array.isArray(usersFromCreateChat)) {
      usersFromCreateChat.forEach(user => {
        if (user && user.id) {
          const userIdStr = typeof user.id === 'bigint' ? user.id.toString() : user.id.toString();
          usersMap.set(userIdStr, user);
          const accessHashStr = user.accessHash ? user.accessHash.toString() : 'N/A';
          console.log(`[MTProto] 📋 Найден пользователь в CreateChat: userId=${userIdStr}, accessHash=${accessHashStr}`);
        }
      });
    }
    
    // ✅ НОВОЕ: Функция для получения accessHash через contacts API
    async function tryGetAccessHash(userId, role, username = null) {
      const userIdNumber = parseInt(userId);
      let accessHash = BigInt(0);
      
      // Сначала проверяем мапу из CreateChat
      const userFromMap = usersMap.get(userId);
      if (userFromMap && userFromMap.accessHash) {
        accessHash = userFromMap.accessHash;
        console.log(`[MTProto] ✅ Найден accessHash для ${role} из CreateChat: ${accessHash}`);
        return accessHash;
      }
      
      // ✅ НОВОЕ: Пытаемся получить через username (contacts.resolveUsername)
      if (username) {
        try {
          // Убираем @ если есть
          const cleanUsername = username.replace('@', '').trim();
          console.log(`[MTProto] 🔍 Пытаемся получить accessHash для ${role} через username: @${cleanUsername}...`);
          
          const resolveResult = await client.invoke(
            new Api.contacts.ResolveUsername({
              username: cleanUsername
            })
          );
          
          if (resolveResult && resolveResult.users && resolveResult.users.length > 0) {
            const user = resolveResult.users[0];
            if (user && user.id && user.id.toString() === userId && user.accessHash) {
              accessHash = user.accessHash;
              console.log(`[MTProto] ✅ Найден accessHash для ${role} через username: ${accessHash}`);
              return accessHash;
            }
          }
          console.log(`[MTProto] ⚠️ ${role} не найден через username @${cleanUsername}`);
        } catch (usernameError) {
          console.log(`[MTProto] ⚠️ Не удалось получить ${role} через username:`, usernameError.message);
        }
      }
      
      // Пытаемся получить через contacts.getContacts
      try {
        console.log(`[MTProto] 🔍 Пытаемся получить accessHash для ${role} через contacts.getContacts...`);
        const contactsResult = await client.invoke(new Api.contacts.GetContacts({ hash: BigInt(0) }));
        
        if (contactsResult && contactsResult.users && Array.isArray(contactsResult.users)) {
          const userInContacts = contactsResult.users.find(u => u && u.id && u.id.toString() === userId);
          if (userInContacts && userInContacts.accessHash) {
            accessHash = userInContacts.accessHash;
            console.log(`[MTProto] ✅ Найден accessHash для ${role} в контактах: ${accessHash}`);
            return accessHash;
          }
        }
        console.log(`[MTProto] ⚠️ ${role} не найден в контактах`);
      } catch (contactsError) {
        console.log(`[MTProto] ⚠️ Не удалось получить контакты для ${role}:`, contactsError.message);
      }
      
      console.log(`[MTProto] ⚠️ accessHash для ${role} не найден, используем 0`);
      return accessHash;
    }
    
    // ✅ НОВОЕ: Функция для добавления пользователя в группу
    async function addUserToChat(userId, role, username = null) {
      try {
        const userIdNumber = parseInt(userId);
        console.log(`[MTProto] 📥 Пытаемся добавить ${role} (userId: ${userIdNumber}${username ? `, username: @${username.replace('@', '')}` : ''}) в группу...`);
        
        // Пытаемся получить accessHash различными способами
        const accessHash = await tryGetAccessHash(userId, role, username);
        
        await client.invoke(
          new Api.messages.AddChatUser({
            chatId: chatIdNumber,
            userId: new Api.InputUser({ userId: userIdNumber, accessHash: accessHash }),
            fwdLimit: 50
          })
        );
        
        console.log(`[MTProto] ✅ ${role} успешно добавлен в группу`);
        return { success: true, role };
      } catch (addError) {
        const errorMessage = addError.message || addError.errorMessage || 'Unknown error';
        const errorCode = addError.code || 'UNKNOWN';
        console.warn(`[MTProto] ⚠️ Не удалось добавить ${role} в группу:`, errorMessage, `(код: ${errorCode})`);
        
        // Логируем специфичные ошибки
        if (errorMessage.includes('USER_PRIVACY_RESTRICTED') || errorMessage.includes('PRIVACY') || errorCode === 406) {
          console.log(`[MTProto] ℹ️ ${role} запретил приглашения в группы - будет отправлена ссылка`);
        } else if (errorMessage.includes('USER_ID_INVALID') || errorCode === 400) {
          console.log(`[MTProto] ℹ️ Не удалось добавить ${role} (USER_ID_INVALID) - вероятно нужен правильный accessHash. Будет отправлена ссылка`);
        }
        
        return { success: false, role, error: errorMessage, errorCode };
      }
    }
    
    // ✅ НОВОЕ: Добавляем участников в группу
    const addResults = [];
    if (owner_telegram_id && owner_telegram_id !== manager_telegram_id) {
      addResults.push(await addUserToChat(owner_telegram_id, 'Owner', owner_telegram_username));
    }
    if (renter_telegram_id && renter_telegram_id !== manager_telegram_id) {
      addResults.push(await addUserToChat(renter_telegram_id, 'Renter', renter_telegram_username));
    }
    
    // Логируем результаты добавления
    const successfulAdds = addResults.filter(r => r.success).length;
    const failedAdds = addResults.filter(r => !r.success).length;
    console.log(`[MTProto] 📊 Результаты добавления участников: ${successfulAdds} успешно, ${failedAdds} не удалось`);
    
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
      // ✅ ИСПРАВЛЕНО: Используем chatPeer (InputPeerChat) вместо chatId
      await client.sendMessage(chatPeer, {
        message: welcomeMessage,
        parseMode: 'html' // ✅ Используем HTML парсинг
      });
      console.log('[MTProto] ✅ Приветственное сообщение отправлено');
    } catch (msgError) {
      console.warn('[MTProto] ⚠️ Не удалось отправить приветственное сообщение:', msgError.message);
    }
    
    // Получаем invite link
    let inviteLink;
    try {
      // ✅ ИСПРАВЛЕНО: Используем chatPeer (InputPeerChat) вместо chatId
      const exportResult = await client.invoke(
        new Api.messages.ExportChatInvite({
          peer: chatPeer
        })
      );
      inviteLink = exportResult.link;
      console.log('[MTProto] ✅ Invite link создан:', inviteLink);
    } catch (inviteError) {
      console.warn('[MTProto] ⚠️ Не удалось создать invite link:', inviteError.message);
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

