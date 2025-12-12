// Скрипт для первой авторизации в Telegram
// Запуск: node auth.js

require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const readline = require('readline');

const API_ID = parseInt(process.env.TELEGRAM_MANAGER_API_ID || '0');
const API_HASH = process.env.TELEGRAM_MANAGER_API_HASH || '';
const MANAGER_PHONE = process.env.TELEGRAM_MANAGER_PHONE || '';

if (!API_ID || !API_HASH || !MANAGER_PHONE) {
  console.error('❌ Установите TELEGRAM_MANAGER_API_ID, TELEGRAM_MANAGER_API_HASH и TELEGRAM_MANAGER_PHONE в .env файле');
  process.exit(1);
}

const stringSession = new StringSession('');
const client = new TelegramClient(stringSession, API_ID, API_HASH, {
  connectionRetries: 5,
});

async function auth() {
  try {
    console.log('🔌 Подключение к Telegram...');
    await client.connect();
    
    if (await client.checkAuthorization()) {
      console.log('✅ Уже авторизован!');
      const sessionString = client.session.save();
      console.log('\n💾 Текущая сессия:');
      console.log(sessionString);
      console.log('\n📝 Добавьте это значение в .env файл как TELEGRAM_MANAGER_SESSION_STRING');
      await client.disconnect();
      return;
    }
    
    console.log('📱 Отправка кода на номер:', MANAGER_PHONE);
    const result = await client.sendCode({ apiId: API_ID, apiHash: API_HASH }, MANAGER_PHONE);
    
    console.log('\n✅ Код отправлен в Telegram!');
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const code = await new Promise((resolve) => {
      rl.question('📝 Введите код из Telegram: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
    
    console.log('🔐 Авторизация...');
    
    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: MANAGER_PHONE,
          phoneCodeHash: result.phoneCodeHash,
          phoneCode: code
        })
      );
    } catch (signInError) {
      // Если требуется пароль (2FA)
      if (signInError.errorMessage === 'SESSION_PASSWORD_NEEDED' || signInError.message?.includes('PASSWORD')) {
        console.log('\n🔒 Требуется пароль двухфакторной аутентификации (2FA)');
        
        const rl2 = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const password = await new Promise((resolve) => {
          rl2.question('📝 Введите пароль 2FA: ', (answer) => {
            rl2.close();
            resolve(answer.trim());
          });
        });
        
        // Получаем информацию о пароле
        const passwordInfo = await client.invoke(new Api.account.GetPassword());
        
        // Вычисляем хеш пароля
        const { computeCheck } = require('telegram/Password');
        const passwordCheck = await computeCheck(passwordInfo, password);
        
        // Проверяем пароль
        await client.invoke(
          new Api.auth.CheckPassword({
            password: passwordCheck
          })
        );
      } else {
        throw signInError;
      }
    }
    
    const sessionString = client.session.save();
    console.log('\n✅ Авторизация успешна!');
    console.log('\n💾 Сохраните эту сессию в .env файл:');
    console.log('TELEGRAM_MANAGER_SESSION_STRING=' + sessionString);
    console.log('\n📝 После этого сервис будет работать автоматически.');
    
    await client.disconnect();
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

auth();

