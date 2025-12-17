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
    
    const { listing_id, owner_telegram_id, renter_telegram_id, manager_telegram_id, listing_title, owner_telegram_username, renter_telegram_username, owner_id, renter_id } = req.body;
    
    console.log('[MTProto] 🔍 Extracted parameters:', {
      listing_id: listing_id || 'MISSING',
      owner_telegram_id: owner_telegram_id || 'MISSING',
      renter_telegram_id: renter_telegram_id || 'MISSING',
      manager_telegram_id: manager_telegram_id || 'MISSING',
      listing_title: listing_title || 'MISSING',
      owner_telegram_username: owner_telegram_username || 'N/A',
      renter_telegram_username: renter_telegram_username || 'N/A',
      owner_id: owner_id || 'MISSING',
      renter_id: renter_id || 'MISSING'
    });
    
    if (!listing_id || !owner_telegram_id || !renter_telegram_id || !manager_telegram_id) {
      console.error('[MTProto] ❌ Missing required parameters:', {
        hasListingId: !!listing_id,
        hasOwnerTelegramId: !!owner_telegram_id,
        hasRenterTelegramId: !!renter_telegram_id,
        hasManagerTelegramId: !!manager_telegram_id
      });
      
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
        
        const addResult = await client.invoke(
          new Api.messages.AddChatUser({
            chatId: chatIdNumber,
            userId: new Api.InputUser({ userId: userIdNumber, accessHash: accessHash }),
            fwdLimit: 50
          })
        );
        
        // Проверяем результат добавления
        // Если есть missingInvitees, значит некоторые пользователи не были добавлены
        if (addResult && addResult.missingInvitees && addResult.missingInvitees.length > 0) {
          const missingUserId = addResult.missingInvitees[0];
          console.warn(`[MTProto] ⚠️ ${role} не был добавлен в группу (missingInvitees содержит userId: ${missingUserId})`);
          console.warn(`[MTProto] ⚠️ Это может быть из-за настроек приватности пользователя`);
          return { success: false, role, error: 'USER_NOT_ADDED', errorCode: 'MISSING_INVITEES', isPrivacyError: true };
        }
        
        console.log(`[MTProto] ✅ ${role} успешно добавлен в группу`);
        return { success: true, role };
      } catch (addError) {
        const errorMessage = addError.message || addError.errorMessage || 'Unknown error';
        const errorCode = addError.code || 'UNKNOWN';
        
        // ✅ ИСПРАВЛЕНО: Правильно определяем ошибки приватности
        const isPrivacyError = errorMessage.includes('USER_PRIVACY_RESTRICTED') || 
                               errorMessage.includes('PRIVACY') || 
                               errorCode === 406 ||
                               errorMessage.includes('privacy') ||
                               errorMessage.includes('PRIVACY_RESTRICTED');
        
        if (isPrivacyError) {
          console.warn(`[MTProto] ⚠️ Не удалось добавить ${role} в группу: настройки приватности не позволяют приглашать в группы`);
          console.log(`[MTProto] ℹ️ ${role} запретил приглашения в группы (код: ${errorCode}) - будет отправлена invite ссылка`);
          return { success: false, role, error: 'USER_PRIVACY_RESTRICTED', errorCode, isPrivacyError: true };
        } else if (errorMessage.includes('USER_ID_INVALID') || errorCode === 400) {
          console.warn(`[MTProto] ⚠️ Не удалось добавить ${role} в группу: USER_ID_INVALID (код: ${errorCode})`);
          console.log(`[MTProto] ℹ️ Не удалось добавить ${role} (USER_ID_INVALID) - вероятно нужен правильный accessHash. Будет отправлена ссылка`);
          return { success: false, role, error: errorMessage, errorCode };
        } else {
          console.warn(`[MTProto] ⚠️ Не удалось добавить ${role} в группу:`, errorMessage, `(код: ${errorCode})`);
          return { success: false, role, error: errorMessage, errorCode };
        }
      }
    }
    
    // ✅ НОВОЕ: Функция для получения информации о пользователе
    async function getUserInfo(userId) {
      try {
        const userIdNumber = parseInt(userId);
        const inputPeer = await client.getInputEntity(userIdNumber);
        const user = await client.getEntity(inputPeer);
        
        if (user && typeof user === 'object') {
          const firstName = user.firstName || '';
          const lastName = user.lastName || '';
          const username = user.username ? `@${user.username}` : '';
          const name = `${firstName} ${lastName}`.trim() || username || 'Пользователь';
          
          return { name, username, firstName, lastName };
        }
      } catch (error) {
        console.warn(`[MTProto] ⚠️ Не удалось получить информацию о пользователе ${userId}:`, error.message);
      }
      return { name: 'Пользователь', username: '', firstName: '', lastName: '' };
    }
    
    // ✅ НОВОЕ: Функция для отправки сообщения в группу
    async function sendGroupMessage(messageText) {
      try {
        console.log('[MTProto] 📤 Отправка сообщения в группу, chatPeer:', chatPeer);
        const result = await client.sendMessage(chatPeer, {
          message: messageText,
          parseMode: 'html'
        });
        console.log('[MTProto] ✅ Сообщение успешно отправлено, result:', result);
        
        return true;
      } catch (error) {
        console.error('[MTProto] ❌ Ошибка при отправке сообщения в группу:', error.message);
        console.error('[MTProto] ❌ Полная ошибка:', error);
        
        return false;
      }
    }
    
    // ✅ УПРОЩЕНО: Добавляем участников в группу и отправляем сообщения по мере присоединения
    const botUsername = 'Renta_rent_bot';
    const listingUrl = `https://t.me/${botUsername}?startapp=listing_${listing_id}`;
    
    let ownerInfo = null;
    let renterInfo = null;
    let thirdMessageSent = false; // ✅ Защита от повторной отправки третьего сообщения
    
    // ✅ Функция для загрузки профиля из Supabase
    async function getProfileFromSupabase(userId) {
      try {
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
        
        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
          console.warn('[MTProto] ⚠️ Supabase credentials not configured, skipping profile load');
          return null;
        }
        
        const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}&select=*`, {
          method: 'GET',
          headers: {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          console.warn('[MTProto] ⚠️ Failed to load profile from Supabase:', response.status);
          return null;
        }
        
        const data = await response.json();
        return data && data.length > 0 ? data[0] : null;
      } catch (error) {
        console.warn('[MTProto] ⚠️ Error loading profile from Supabase:', error.message);
        return null;
      }
    }
    
    // ✅ Функция для форматирования информации профиля
    function formatProfileInfo(profile) {
      if (!profile) return '';
      
      let info = '';
      
      // Тип пользователя
      if (profile.user_type) {
        const userTypeLabels = {
          'landlord': '🏠 Сдаю квартиру',
          'tenant': '🔍 Ищу квартиру'
        };
        info += `${userTypeLabels[profile.user_type] || profile.user_type}\n`;
      }
      
      // С кем живет
      if (profile.living_with) {
        const livingLabels = {
          'alone': 'Один/одна',
          'family': 'С семьей',
          'partner': 'С партнером',
          'roommates': 'С соседями',
          'children': 'С детьми'
        };
        info += `👥 С кем живет: ${livingLabels[profile.living_with] || profile.living_with}\n`;
        if (profile.living_with_details) {
          info += `   ${profile.living_with_details.substring(0, 80)}${profile.living_with_details.length > 80 ? '...' : ''}\n`;
        }
      }
      
      // Вредные привычки
      const habits = [];
      if (profile.smoking_behavior) {
        const smokingLabels = {
          'none': '🚬 Не курю',
          'outside': '🚬 Курю на улице',
          'inside': '🚬 Курю дома'
        };
        habits.push(smokingLabels[profile.smoking_behavior] || `🚬 ${profile.smoking_behavior}`);
      } else if (profile.smoking) habits.push('🚬 Курит');
      if (profile.drinking) {
        const drinkingLabels = {
          'never': '🍷 Алкоголь: никогда',
          'rarely': '🍷 Алкоголь: редко',
          'sometimes': '🍷 Алкоголь: иногда',
          'often': '🍷 Алкоголь: часто'
        };
        habits.push(drinkingLabels[profile.drinking] || `🍷 Алкоголь: ${profile.drinking}`);
      }
      if (profile.pets && profile.pets !== 'none') {
        const petsLabels = {
          'cats': '🐱 Коты',
          'dogs': '🐶 Собаки',
          'other': '🐾 Другие животные',
          'multiple': '🐾 Несколько животных'
        };
        habits.push(petsLabels[profile.pets] || `🐾 ${profile.pets}`);
        if (profile.pets_details) {
          habits[habits.length - 1] += `: ${profile.pets_details.substring(0, 50)}${profile.pets_details.length > 50 ? '...' : ''}`;
        }
      }
      if (habits.length > 0) {
        info += `\n${habits.join('\n')}\n`;
      }
      
      // Опыт аренды
      if (profile.rental_experience) {
        const experienceLabels = {
          'none': 'Нет опыта',
          'less_than_year': 'Меньше года',
          '1_3_years': '1-3 года',
          '3_5_years': '3-5 лет',
          'more_than_5_years': 'Более 5 лет'
        };
        info += `\n📋 Опыт аренды: ${experienceLabels[profile.rental_experience] || profile.rental_experience}\n`;
        if (profile.rental_references) {
          info += `📝 Рекомендации: ${profile.rental_references.substring(0, 80)}${profile.rental_references.length > 80 ? '...' : ''}\n`;
        }
      }
      
      // Финансовые условия
      if (profile.employment_status) {
        const employmentLabels = {
          'employed': '💼 Работает по найму',
          'self_employed': '💼 Самозанятый',
          'student': '🎓 Студент',
          'unemployed': '💼 Безработный',
          'retired': '👴 Пенсионер'
        };
        info += `\n💼 Занятость: ${employmentLabels[profile.employment_status] || profile.employment_status}\n`;
        if (profile.employment_details) {
          info += `   ${profile.employment_details.substring(0, 80)}${profile.employment_details.length > 80 ? '...' : ''}\n`;
        }
      }
      
      // ✅ РОЛЬ 1: Сдает (Арендодатель) - требования к арендатору
      if (profile.user_type === 'landlord') {
        const tenantInfo = [];
        if (profile.landlord_prefers_age) {
          tenantInfo.push(`Возраст арендатора: ${profile.landlord_prefers_age}`);
        }
        if (profile.landlord_prefers_living_composition && Array.isArray(profile.landlord_prefers_living_composition) && profile.landlord_prefers_living_composition.length > 0) {
          tenantInfo.push(`Состав жильцов: ${profile.landlord_prefers_living_composition.join(', ')}`);
        }
        if (profile.landlord_prefers_smoking) {
          const labels = { 'none': '🚫 Нельзя', 'outside': '🚬 На улице', 'inside': '✅ Можно' };
          tenantInfo.push(`Курение: ${labels[profile.landlord_prefers_smoking] || profile.landlord_prefers_smoking}`);
          if (profile.landlord_prefers_smoking === 'inside' && profile.landlord_prefers_smoking_details) {
            tenantInfo.push(`  Детали: ${profile.landlord_prefers_smoking_details}`);
          }
        }
        if (profile.landlord_prefers_pets) {
          const labels = { 'none': '❌ Нет', 'allowed': '✅ Да' };
          tenantInfo.push(`Животные: ${labels[profile.landlord_prefers_pets] || profile.landlord_prefers_pets}`);
          if (profile.landlord_prefers_pets === 'allowed' && profile.landlord_prefers_pets_details) {
            tenantInfo.push(`  Детали: ${profile.landlord_prefers_pets_details}`);
          }
        }
        if (profile.landlord_prefers_children) {
          const labels = { 'none': '❌ Нет', 'allowed': '✅ Да' };
          tenantInfo.push(`Дети: ${labels[profile.landlord_prefers_children] || profile.landlord_prefers_children}`);
          if (profile.landlord_prefers_children === 'allowed' && profile.landlord_prefers_children_age) {
            tenantInfo.push(`  Возраст: ${profile.landlord_prefers_children_age}`);
          }
        }
        if (profile.landlord_prefers_guests) {
          const labels = { 'allowed': '✅ Можно', 'not_welcome': '🚫 Не желательно', 'sometimes': '⚠️ Ограниченно' };
          tenantInfo.push(`Гости: ${labels[profile.landlord_prefers_guests] || profile.landlord_prefers_guests}`);
        }
        if (profile.landlord_prefers_rental_duration) {
          const labels = {
            'less_than_3_months': 'Меньше трех месяцев',
            '3_6_months': 'От 3 до 6 месяцев',
            '6_12_months': 'От 6 до года',
            '12_24_months': 'От года до двух',
            '2_plus_years': 'Больше 2+'
          };
          tenantInfo.push(`Срок аренды: ${labels[profile.landlord_prefers_rental_duration] || profile.landlord_prefers_rental_duration}`);
        }
        if (profile.landlord_ideal_tenant) {
          tenantInfo.push(`Идеальный арендатор: ${profile.landlord_ideal_tenant.substring(0, 100)}${profile.landlord_ideal_tenant.length > 100 ? '...' : ''}`);
        }
        if (tenantInfo.length > 0) {
          info += `\n\n🏠 Требования к арендатору:\n${tenantInfo.join('\n')}\n`;
        }
      }
      
      // ✅ РОЛЬ 2: Снимает (Арендатор) - информация о себе
      if (profile.user_type === 'tenant') {
        const tenantInfo = [];
        if (profile.tenant_age) {
          tenantInfo.push(`Возраст: ${profile.tenant_age} лет`);
        }
        if (profile.tenant_living_with) {
          tenantInfo.push(`С кем будете проживать: ${profile.tenant_living_with}`);
        }
        if (profile.tenant_smoking !== undefined) {
          tenantInfo.push(`Курите: ${profile.tenant_smoking ? '✅ Да' : '❌ Нет'}`);
        }
        if (profile.tenant_has_children !== undefined) {
          tenantInfo.push(`Есть дети: ${profile.tenant_has_children ? '✅ Да' : '❌ Нет'}`);
        }
        if (profile.tenant_employment) {
          tenantInfo.push(`Работа / доход: ${profile.tenant_employment.substring(0, 80)}${profile.tenant_employment.length > 80 ? '...' : ''}`);
        }
        if (profile.tenant_previous_landlord_feedback) {
          tenantInfo.push(`Отзыв предыдущего арендодателя: ${profile.tenant_previous_landlord_feedback.substring(0, 100)}${profile.tenant_previous_landlord_feedback.length > 100 ? '...' : ''}`);
        }
        if (profile.tenant_guests_frequency) {
          tenantInfo.push(`Частота гостей: ${profile.tenant_guests_frequency}`);
        }
        if (profile.tenant_rental_duration) {
          const labels = {
            'less_than_3_months': 'Меньше трех месяцев',
            '3_6_months': 'От 3 до 6 месяцев',
            '6_12_months': 'От 6 до года',
            '12_24_months': 'От года до двух',
            '2_plus_years': 'Больше 2+'
          };
          tenantInfo.push(`Срок аренды: ${labels[profile.tenant_rental_duration] || profile.tenant_rental_duration}`);
        }
        if (profile.tenant_social_links && Array.isArray(profile.tenant_social_links) && profile.tenant_social_links.length > 0) {
          tenantInfo.push(`Соцсети: ${profile.tenant_social_links.filter(l => l).join(', ')}`);
        }
        if (tenantInfo.length > 0) {
          info += `\n\n🔍 О себе:\n${tenantInfo.join('\n')}\n`;
        }
      }
      
      return info.trim();
    }
    
    // ✅ Функция для отправки третьего сообщения (общая информация об участниках)
    async function sendThirdMessage() {
      // ✅ Защита от повторной отправки
      if (thirdMessageSent) {
        console.log('[MTProto] ⚠️ Третье сообщение уже было отправлено, пропускаем...');
        return;
      }
      
      try {
        console.log('[MTProto] 📨 Отправка третьего сообщения с информацией об участниках...');
        console.log('[MTProto] 📊 Проверка переменных: chatPeer=', !!chatPeer, ', ownerInfo=', !!ownerInfo, ', renterInfo=', !!renterInfo);
        
        thirdMessageSent = true; // Устанавливаем флаг до отправки, чтобы предотвратить повторную отправку
        
        // Получаем информацию о всех участниках, если еще не получили
        if (!ownerInfo && owner_telegram_id) {
          ownerInfo = await getUserInfo(owner_telegram_id);
        }
        if (!renterInfo && renter_telegram_id) {
          renterInfo = await getUserInfo(renter_telegram_id);
        }
        
        // ✅ НОВОЕ: Загружаем полные профили из Supabase для актуальной информации
        let ownerProfile = null;
        let renterProfile = null;
        if (owner_id) {
          ownerProfile = await getProfileFromSupabase(owner_id);
          console.log('[MTProto] ✅ Loaded owner profile from Supabase:', ownerProfile ? 'found' : 'not found');
        }
        if (renter_id) {
          renterProfile = await getProfileFromSupabase(renter_id);
          console.log('[MTProto] ✅ Loaded renter profile from Supabase:', renterProfile ? 'found' : 'not found');
        }
        
        // ✅ НОВОЕ: Третье сообщение с информацией об участниках и ссылками
        // ✅ ИСПРАВЛЕНО: Используем формат Telegram Mini App для открытия в боте
        let participantsInfo = ``;
        const botUsername = 'Renta_rent_bot';
        
        // Информация об арендодателе
        if (ownerInfo && owner_id) {
          participantsInfo += `🏠 <b>Арендодатель:</b> ${ownerInfo.name}\n`;
          const listingLink = `https://t.me/${botUsername}?startapp=listing_${listing_id}`;
          const ownerProfileLink = `https://t.me/${botUsername}?startapp=profile_${owner_id}`;
          participantsInfo += `🔗 Посмотреть объявление: <a href="${listingLink}">ссылка</a>\n`;
          participantsInfo += `🔗 Посмотреть отзывы об арендодателе: <a href="${ownerProfileLink}">ссылка</a>\n`;
          
          // ✅ НОВОЕ: Добавляем актуальную информацию профиля
          if (ownerProfile) {
            const profileInfo = formatProfileInfo(ownerProfile);
            if (profileInfo) {
              participantsInfo += `\n📊 <b>Информация об арендодателе:</b>\n${profileInfo}\n`;
            }
          }
          participantsInfo += `\n`;
        }
        
        // Информация об арендаторе
        if (renterInfo && renter_id) {
          participantsInfo += `🔍 <b>Арендатор:</b> ${renterInfo.name}\n`;
          const renterProfileLink = `https://t.me/${botUsername}?startapp=profile_${renter_id}`;
          participantsInfo += `🔗 Посмотреть отзывы об арендаторе: <a href="${renterProfileLink}">ссылка</a>\n`;
          
          // ✅ НОВОЕ: Добавляем актуальную информацию профиля
          if (renterProfile) {
            const profileInfo = formatProfileInfo(renterProfile);
            if (profileInfo) {
              participantsInfo += `\n📊 <b>Информация об арендаторе:</b>\n${profileInfo}\n`;
            }
          }
        }
        
        await sendGroupMessage(participantsInfo);
        console.log('[MTProto] ✅ Третье сообщение отправлено');
      } catch (error) {
        console.error('[MTProto] ❌ Ошибка при отправке третьего сообщения:', error.message);
        thirdMessageSent = false; // Сбрасываем флаг при ошибке, чтобы можно было повторить
      }
    }
    
    // ✅ УДАЛЕНО: Старая сложная функция sendSecondParticipantMessages
    // Теперь используем простую логику с participantCount
    
    // ✅ ИСПРАВЛЕНО: Попытка добавить всех участников, затем проверка реального состава группы
    console.log('[MTProto] 🔄 Начинаем попытку добавления участников...');
    
    // Попытка добавить owner
    let ownerAdded = false;
    if (owner_telegram_id && owner_telegram_id !== manager_telegram_id) {
      console.log('[MTProto] 🔄 Попытка добавить Owner в группу...');
      const ownerResult = await addUserToChat(owner_telegram_id, 'Owner', owner_telegram_username);
      console.log('[MTProto] 📊 Результат добавления Owner:', ownerResult);
      ownerAdded = ownerResult.success;
      
      if (ownerAdded) {
        ownerInfo = await getUserInfo(owner_telegram_id);
        console.log('[MTProto] ✅ Owner успешно добавлен автоматически');
      } else {
        console.log('[MTProto] ⚠️ Owner не был добавлен автоматически, причина:', ownerResult.error);
        ownerInfo = await getUserInfo(owner_telegram_id);
      }
    }
    
    // Попытка добавить renter
    let renterAdded = false;
    if (renter_telegram_id && renter_telegram_id !== manager_telegram_id) {
      console.log('[MTProto] 🔄 Попытка добавить Renter в группу...');
      const renterResult = await addUserToChat(renter_telegram_id, 'Renter', renter_telegram_username);
      console.log('[MTProto] 📊 Результат добавления Renter:', renterResult);
      renterAdded = renterResult.success;
      
      if (renterAdded) {
        renterInfo = await getUserInfo(renter_telegram_id);
        console.log('[MTProto] ✅ Renter успешно добавлен автоматически');
      } else {
        console.log('[MTProto] ⚠️ Renter не был добавлен автоматически, причина:', renterResult.error);
        renterInfo = await getUserInfo(renter_telegram_id);
      }
    }
    
    // ✅ КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Проверяем реальный состав группы после всех попыток добавления
    // Небольшая задержка, чтобы Telegram успел обновить информацию о группе
    console.log('[MTProto] ⏳ Ожидание 1 секунду перед проверкой состава группы...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('[MTProto] 🔍 Проверяем реальный состав группы...');
    let actualParticipantsCount = 0;
    let ownerInGroup = false;
    let renterInGroup = false;
    
    try {
      // Получаем информацию о чате
      const fullChat = await client.invoke(
        new Api.messages.GetFullChat({
          chatId: chatIdNumber
        })
      );
      
      console.log('[MTProto] 📋 Информация о чате получена');
      console.log('[MTProto] 📋 Структура fullChat:', {
        hasFullChat: !!fullChat?.fullChat,
        fullChatClassName: fullChat?.fullChat?.className,
        hasParticipants: !!fullChat?.fullChat?.participants,
        participantsClassName: fullChat?.fullChat?.participants?.className
      });
      
      // Проверяем участников чата
      if (fullChat && fullChat.fullChat && fullChat.fullChat.participants) {
        const participants = fullChat.fullChat.participants;
        console.log('[MTProto] 👥 Участники чата:', participants.className);
        console.log('[MTProto] 👥 Структура participants:', {
          className: participants.className,
          hasParticipantsArray: !!participants.participants,
          participantsIsArray: Array.isArray(participants.participants),
          participantsLength: participants.participants?.length || 0
        });
        
        if (participants.participants && Array.isArray(participants.participants)) {
          // Считаем участников (исключая менеджера)
          console.log('[MTProto] 🔍 Проверяем каждого участника...');
          for (const participant of participants.participants) {
            // ✅ ИСПРАВЛЕНО: Нормализуем userId к строке для корректного сравнения
            let userId = null;
            if (participant.userId) {
              // userId может быть BigInt, Number или String
              if (typeof participant.userId === 'bigint') {
                userId = participant.userId.toString();
              } else if (typeof participant.userId === 'number') {
                userId = participant.userId.toString();
              } else {
                userId = String(participant.userId);
              }
            }
            
            console.log('[MTProto] 🔍 Участник:', {
              className: participant?.className,
              hasUserId: !!participant?.userId,
              userId: userId || 'N/A',
              userIdType: typeof participant?.userId,
              manager_telegram_id,
              owner_telegram_id,
              renter_telegram_id
            });
            
            // ✅ ИСПРАВЛЕНО: Нормализуем все ID к строкам для сравнения
            const normalizedManagerId = String(manager_telegram_id);
            const normalizedOwnerId = String(owner_telegram_id);
            const normalizedRenterId = String(renter_telegram_id);
            
            if (userId && userId !== normalizedManagerId) {
              actualParticipantsCount++;
              console.log('[MTProto] ✅ Участник добавлен в подсчет (не менеджер):', userId);
              
              if (userId === normalizedOwnerId) {
                ownerInGroup = true;
                console.log('[MTProto] ✅ Owner найден в группе');
              }
              if (userId === normalizedRenterId) {
                renterInGroup = true;
                console.log('[MTProto] ✅ Renter найден в группе');
              }
            } else if (userId === normalizedManagerId) {
              console.log('[MTProto] ⏭️ Пропускаем менеджера:', userId);
            } else {
              console.log('[MTProto] ⚠️ Участник без userId или с неожиданным форматом');
            }
          }
        } else {
          console.warn('[MTProto] ⚠️ participants.participants не является массивом:', typeof participants.participants);
        }
        
        console.log('[MTProto] 📊 Реальный состав группы:', {
          totalParticipants: actualParticipantsCount,
          ownerInGroup,
          renterInGroup,
          manager_telegram_id,
          owner_telegram_id,
          renter_telegram_id
        });
      } else {
        console.warn('[MTProto] ⚠️ Не удалось получить участников из fullChat');
      }
    } catch (getFullChatError) {
      console.error('[MTProto] ⚠️ Ошибка при получении информации о чате:', getFullChatError.message);
      // Fallback: используем информацию о том, кто был успешно добавлен
      if (ownerAdded) {
        actualParticipantsCount++;
        ownerInGroup = true;
      }
      if (renterAdded) {
        actualParticipantsCount++;
        renterInGroup = true;
      }
      console.log('[MTProto] 📊 Используем fallback данные:', {
        actualParticipantsCount,
        ownerInGroup,
        renterInGroup
      });
    }
    
    // ✅ Отправляем сообщения на основе РЕАЛЬНОГО состава группы
    // actualParticipantsCount считает только owner и renter (менеджер исключен)
    // 1 участник = менеджер + один из участников (owner или renter) → первое сообщение
    // 2 участника = менеджер + owner + renter → второе и третье сообщения
    console.log('[MTProto] 🎯 Принятие решения о сообщениях:', {
      actualParticipantsCount,
      ownerInGroup,
      renterInGroup,
      condition1: actualParticipantsCount === 1,
      condition2: actualParticipantsCount === 2 && ownerInGroup && renterInGroup
    });
    
    if (actualParticipantsCount === 1) {
      // Первое сообщение - только один участник в группе (менеджер + owner ИЛИ менеджер + renter)
      console.log('[MTProto] ✅ В группе 1 участник (не считая менеджера), отправляем первое сообщение...');
      
      const firstMessage = ownerInGroup 
        ? `🙏 Спасибо, что выбрали Renty!\n\n` +
          `Сейчас ждем второго участника (арендатора).\n\n` +
          `Как только он присоединится, начнем обсуждение.\n\n` +
          `А пока можете еще раз посмотреть объявление:\n` +
          `🔗 <a href="${listingUrl}">Посмотреть объявление</a>`
        : `🙏 Спасибо, что выбрали Renty!\n\n` +
          `Сейчас ждем второго участника (арендодателя).\n\n` +
          `Как только он присоединится, начнем обсуждение.\n\n` +
          `А пока можете еще раз посмотреть объявление:\n` +
          `🔗 <a href="${listingUrl}">Посмотреть объявление</a>`;
      
      const firstMessageResult = await sendGroupMessage(firstMessage);
      console.log('[MTProto] 📨 Результат отправки первого сообщения:', firstMessageResult);
      
      // ✅ НОВОЕ: Запускаем фоновую проверку на присоединение второго участника
      // Проверяем каждые 3 секунды в течение 30 секунд
      console.log('[MTProto] 🔄 Запускаем фоновую проверку на присоединение второго участника...');
      console.log('[MTProto] 📊 Контекст для фоновой проверки:', {
        chatIdNumber,
        owner_telegram_id,
        renter_telegram_id,
        manager_telegram_id,
        hasChatPeer: !!chatPeer,
        ownerInGroup,
        renterInGroup
      });
      
      const checkSecondParticipant = async () => {
        console.log('[MTProto] 🔄 Фоновая проверка ЗАПУЩЕНА');
        const maxChecks = 10; // 10 проверок по 3 секунды = 30 секунд
        const checkInterval = 3000; // 3 секунды
        
        for (let i = 0; i < maxChecks; i++) {
          if (i > 0) {
            // Ждем только перед последующими проверками, не перед первой
            await new Promise(resolve => setTimeout(resolve, checkInterval));
          }
          
          try {
            console.log(`[MTProto] 🔍 Проверка ${i + 1}/${maxChecks}: проверяем состав группы...`);
            const fullChat = await client.invoke(
              new Api.messages.GetFullChat({
                chatId: chatIdNumber
              })
            );
            
            let currentParticipantsCount = 0;
            let currentOwnerInGroup = false;
            let currentRenterInGroup = false;
            
            if (fullChat && fullChat.fullChat && fullChat.fullChat.participants) {
              const participants = fullChat.fullChat.participants;
              
              if (participants.participants && Array.isArray(participants.participants)) {
                const normalizedManagerId = String(manager_telegram_id);
                const normalizedOwnerId = String(owner_telegram_id);
                const normalizedRenterId = String(renter_telegram_id);
                
                for (const participant of participants.participants) {
                  let userId = null;
                  if (participant.userId) {
                    if (typeof participant.userId === 'bigint') {
                      userId = participant.userId.toString();
                    } else if (typeof participant.userId === 'number') {
                      userId = participant.userId.toString();
                    } else {
                      userId = String(participant.userId);
                    }
                  }
                  
                  if (userId && userId !== normalizedManagerId) {
                    currentParticipantsCount++;
                    if (userId === normalizedOwnerId) currentOwnerInGroup = true;
                    if (userId === normalizedRenterId) currentRenterInGroup = true;
                  }
                }
              }
            }
            
            console.log(`[MTProto] 📊 Проверка ${i + 1}: участников = ${currentParticipantsCount}, owner=${currentOwnerInGroup}, renter=${currentRenterInGroup}`);
            
            // Если оба участника теперь в группе, отправляем второе и третье сообщения
            if (currentParticipantsCount >= 2 && currentOwnerInGroup && currentRenterInGroup) {
              console.log('[MTProto] ✅ Второй участник присоединился! Отправляем второе и третье сообщения...');
              
              const secondMessage = `✅ Все в сборе! Можете начинать обсуждение.\n\n` +
                `Задавайте друг другу вопросы, обсуждайте детали аренды.\n\n` +
                `Мы будем следить за диалогом, чтобы все было прозрачно и честно.\n\n` +
                `Мы всегда на связи и готовы вам помочь! 🤝`;
              
              const secondMessageResult = await sendGroupMessage(secondMessage);
              if (secondMessageResult) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                await sendThirdMessage();
                console.log('[MTProto] ✅ Второе и третье сообщения отправлены после присоединения второго участника');
              }
              
              return; // Завершаем проверки
            }
          } catch (checkError) {
            console.error(`[MTProto] ⚠️ Ошибка при проверке ${i + 1}:`, checkError.message);
          }
        }
        
        console.log('[MTProto] ⏰ Завершена фоновая проверка - второй участник не присоединился в течение 30 секунд');
      };
      
      // Запускаем проверку асинхронно (не блокируем ответ)
      checkSecondParticipant().catch(err => {
        console.error('[MTProto] ❌ Ошибка в фоновой проверке:', err);
      });
      
    } else if (actualParticipantsCount === 2 && ownerInGroup && renterInGroup) {
      // Второе и третье сообщение - оба участника в группе (менеджер + owner + renter)
      console.log('[MTProto] ✅ В группе 2 участника (не считая менеджера): owner и renter, отправляем второе и третье сообщения...');
      
      const secondMessage = `✅ Все в сборе! Можете начинать обсуждение.\n\n` +
        `Задавайте друг другу вопросы, обсуждайте детали аренды.\n\n` +
        `Мы будем следить за диалогом, чтобы все было прозрачно и честно.\n\n` +
        `Мы всегда на связи и готовы вам помочь! 🤝`;
      
      const secondMessageResult = await sendGroupMessage(secondMessage);
      console.log('[MTProto] 📨 Результат отправки второго сообщения:', secondMessageResult);
      
      if (secondMessageResult) {
        // ✅ Через 2 секунды отправляем третье сообщение
        console.log('[MTProto] ⏳ Ожидание 2 секунды перед отправкой третьего сообщения...');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('[MTProto] ⏳ 2 секунды прошли, вызываем sendThirdMessage()...');
        
        await sendThirdMessage();
        console.log('[MTProto] ✅ sendThirdMessage() завершена');
      } else {
        console.error('[MTProto] ❌ Второе сообщение не отправлено, третье сообщение не будет отправлено');
      }
    } else {
      // Неожиданная ситуация: либо 0 участников, либо не оба участника присутствуют при count === 2
      console.warn('[MTProto] ⚠️ Неожиданное количество участников или состав:', {
        actualParticipantsCount,
        ownerInGroup,
        renterInGroup
      });
      
      // Если count === 2, но не оба участника присутствуют, все равно отправляем сообщения
      if (actualParticipantsCount === 2 && (ownerInGroup || renterInGroup)) {
        console.log('[MTProto] ⚠️ Count === 2, но не оба участника найдены, все равно отправляем сообщения...');
        const secondMessage = `✅ Все в сборе! Можете начинать обсуждение.\n\n` +
          `Задавайте друг другу вопросы, обсуждайте детали аренды.\n\n` +
          `Мы будем следить за диалогом, чтобы все было прозрачно и честно.\n\n` +
          `Мы всегда на связи и готовы вам помочь! 🤝`;
        
        const secondMessageResult = await sendGroupMessage(secondMessage);
        if (secondMessageResult) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          await sendThirdMessage();
        }
      }
    }
    
    // Логируем результаты
    console.log(`[MTProto] 📊 Итоговые результаты: ${actualParticipantsCount} участников в группе`);
    
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

