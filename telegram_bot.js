// telegram_bot.js (Fully Fixed & Updated)
import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import path from "path";
import readline from "readline";

// -----------------------
// CONFIG
// -----------------------
const CONFIG_PATH = path.join(process.cwd(), "config.json");
let BOT_CONFIG = {};

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    BOT_CONFIG = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } else {
    BOT_CONFIG = {
      bot_token: "",
      admin_id: "",
      users: {},
      pending_requests: {},
      active_passkeys: {},
      active_connections: {},
      broadcast_mode: false,
      notify_admin_on_access_attempt: true,
      passkey_length: 6,
      passkey_timeout_minutes: 30
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(BOT_CONFIG, null, 2));
  }

  BOT_CONFIG.admin_id = String(BOT_CONFIG.admin_id).trim();

  // Ensure admin is active
  if (BOT_CONFIG.admin_id && !BOT_CONFIG.users[BOT_CONFIG.admin_id]) {
    BOT_CONFIG.users[BOT_CONFIG.admin_id] = { active: true, numbers: [], deleted_messages: [] };
  } else if (BOT_CONFIG.admin_id) {
    BOT_CONFIG.users[BOT_CONFIG.admin_id].active = true;
  }

  return BOT_CONFIG;
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(BOT_CONFIG, null, 2));
}

// -----------------------
// PASSKEY UTILITIES
// -----------------------
function generatePasskey(length = BOT_CONFIG.passkey_length) {
  let key;
  do {
    key = "";
    for (let i = 0; i < length; i++) key += Math.floor(Math.random() * 10);
  } while (Object.values(BOT_CONFIG.active_passkeys).map(r => r.key).includes(key));
  return key;
}

function isAdmin(userId) {
  return String(userId) === BOT_CONFIG.admin_id;
}

function checkPasskey(userId, key) {
  const record = BOT_CONFIG.active_passkeys[userId];
  if (!record) return false;
  if (record.key !== key) return false;
  if (Date.now() > record.expires_at) {
    delete BOT_CONFIG.active_passkeys[userId];
    saveConfig();
    return false;
  }
  return true;
}

// -----------------------
// TOKEN HANDLING
// -----------------------
async function getBotToken() {
  if (process.env.BOT_TOKEN) return process.env.BOT_TOKEN;
  if (BOT_CONFIG.bot_token?.trim()) return BOT_CONFIG.bot_token;

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Enter your Telegram bot token: ", (answer) => {
      BOT_CONFIG.bot_token = answer.trim();
      saveConfig();
      rl.close();
      resolve(BOT_CONFIG.bot_token);
    });
  });
}

// -----------------------
// MAIN BOT FUNCTION
// -----------------------
export default async function startTelegramBot() {
  BOT_CONFIG = loadConfig();
  const bot = new TelegramBot(await getBotToken(), { polling: true });

  // -----------------------
  // /start COMMAND
  // -----------------------
  bot.onText(/\/start/, async (msg) => {
    const userId = String(msg.from.id);

    if (isAdmin(userId)) {
      bot.sendMessage(msg.chat.id, "✅ Admin access granted. You have full control.");
      return;
    }

    if (!BOT_CONFIG.users[userId] || !BOT_CONFIG.users[userId].active) {
      bot.sendMessage(msg.chat.id, "⏳ Awaiting admin authorization. Requesting passkey...");
      if (BOT_CONFIG.pending_requests[userId]) return;

      BOT_CONFIG.pending_requests[userId] = true;
      saveConfig();

      const requestButtons = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: `✅ Authorize ${userId}`, callback_data: `authorize_request_${userId}` },
              { text: `❌ Ignore ${userId}`, callback_data: `ignore_request_${userId}` }
            ]
          ]
        }
      };

      bot.sendMessage(BOT_CONFIG.admin_id, `User ${userId} wants to access the bot.`, requestButtons);
    } else {
      bot.sendMessage(msg.chat.id, "✅ Bot unlocked. You can now use all permitted commands.");
    }
  });

  // -----------------------
  // /verify COMMAND
  // -----------------------
  bot.onText(/\/verify (.+)/, (msg, match) => {
    const userId = String(msg.from.id);
    const key = match[1];

    if (isAdmin(userId)) {
      bot.sendMessage(msg.chat.id, "✅ Admin access is always active.");
      return;
    }

    if (checkPasskey(userId, key)) {
      BOT_CONFIG.users[userId] = { active: true, numbers: [], deleted_messages: [] };
      delete BOT_CONFIG.active_passkeys[userId];
      delete BOT_CONFIG.pending_requests[userId];
      saveConfig();
      bot.sendMessage(msg.chat.id, "✅ Access granted! You can now use the bot.");
    } else {
      bot.sendMessage(msg.chat.id, "❌ Invalid or expired passkey. Please request a new one using /start.");
    }
  });

  // -----------------------
  // /connect, /broadcast, /disconnect
  // -----------------------
  BOT_CONFIG.active_connections = BOT_CONFIG.active_connections || {};

  bot.onText(/\/connect (.+)/, (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const targetUserId = String(match[1]);
    if (!BOT_CONFIG.users[targetUserId]) return bot.sendMessage(msg.chat.id, "User not found.");
    BOT_CONFIG.active_connections[targetUserId] = true;
    saveConfig();
    bot.sendMessage(msg.chat.id, `✅ Connected to user ${targetUserId}.`);
    bot.sendMessage(targetUserId, "💬 Admin is now connected. You can chat through the bot.");
  });

  bot.onText(/\/broadcast/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    BOT_CONFIG.broadcast_mode = true;
    saveConfig();
    bot.sendMessage(msg.chat.id, "📢 Broadcast mode activated. Messages will be sent to all users.");
  });

  bot.onText(/\/disconnect/, (msg) => {
    if (!isAdmin(msg.from.id)) return;
    BOT_CONFIG.active_connections = {};
    BOT_CONFIG.broadcast_mode = false;
    saveConfig();
    bot.sendMessage(msg.chat.id, "❌ Disconnected from all users / broadcast ended.");
  });

  // -----------------------
  // CALLBACK QUERIES (Passkey Flow)
  // -----------------------
  bot.on("callback_query", async (query) => {
    const data = query.data;
    const userId = data.split("_").slice(2).join("_");

    if (!isAdmin(query.from.id)) {
      bot.answerCallbackQuery(query.id, { text: "❌ You are not admin" });
      return;
    }

    if (data.startsWith("authorize_request_")) {
      const passkey = generatePasskey();
      BOT_CONFIG.active_passkeys[userId] = {
        key: passkey,
        expires_at: Date.now() + BOT_CONFIG.passkey_timeout_minutes * 60 * 1000
      };
      saveConfig();

      const confirmButtons = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Send to User", callback_data: `send_passkey_${userId}` },
              { text: "❌ Cancel", callback_data: `cancel_passkey_${userId}` }
            ]
          ]
        }
      };
      bot.sendMessage(BOT_CONFIG.admin_id, `Passkey generated for ${userId}: ${passkey}`, confirmButtons);
    } else if (data.startsWith("ignore_request_")) {
      delete BOT_CONFIG.pending_requests[userId];
      saveConfig();
      bot.sendMessage(BOT_CONFIG.admin_id, `Ignored access request from ${userId}.`);
      bot.sendMessage(userId, "❌ Your access request was ignored by the admin.");
    } else if (data.startsWith("send_passkey_")) {
      const passkeyData = BOT_CONFIG.active_passkeys[userId];
      if (!passkeyData) return;
      bot.sendMessage(userId, `🔑 Your passkey: *${passkeyData.key}*\nPlease enter it using /verify <passkey> within ${BOT_CONFIG.passkey_timeout_minutes} minutes.`, { parse_mode: "Markdown" });
      bot.sendMessage(BOT_CONFIG.admin_id, `Passkey sent to ${userId}.`);
    } else if (data.startsWith("cancel_passkey_")) {
      delete BOT_CONFIG.active_passkeys[userId];
      delete BOT_CONFIG.pending_requests[userId];
      saveConfig();
      bot.sendMessage(BOT_CONFIG.admin_id, `Passkey sending cancelled for ${userId}.`);
      bot.sendMessage(userId, "❌ Your access request was cancelled by the admin.");
    }

    bot.answerCallbackQuery(query.id);
  });

  // -----------------------
  // MESSAGE FORWARDING
  // -----------------------
  bot.on("message", (msg) => {
    const fromId = String(msg.from.id);

    if (isAdmin(fromId)) {
      // Broadcast
      if (BOT_CONFIG.broadcast_mode && msg.text) {
        for (const uid of Object.keys(BOT_CONFIG.users)) {
          bot.sendMessage(uid, `📢 Admin Broadcast: ${msg.text}`);
        }
      }
      // Reply forwarding
      else if (msg.reply_to_message && msg.reply_to_message.forward_from) {
        const targetId = String(msg.reply_to_message.forward_from.id);
        if (BOT_CONFIG.active_connections[targetId]) {
          bot.sendMessage(targetId, `💬 Admin: ${msg.text}`);
        }
      }
      return;
    }

    // Forward user messages to admin
    if (BOT_CONFIG.users[fromId]?.active || BOT_CONFIG.active_connections[fromId]) {
      bot.sendMessage(BOT_CONFIG.admin_id, `💬 ${fromId}: ${msg.text}`);
    }
  });

  console.log("✅ Telegram bot fully updated and running...");
  return bot;
        }
