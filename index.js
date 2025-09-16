// index.js
import startTelegramBot from "./telegram_bot.js"; // default export
import WhatsAppBot, { runWhatsAppBot, bindTelegramEvents } from "./whatsapp_bot.js";

const run = async () => {
  try {
    // 1️⃣ Start Telegram bot first
    const telegramBot = await startTelegramBot();

    // 2️⃣ Bind Telegram events to WhatsApp bot
    bindTelegramEvents(telegramBot);

    // 3️⃣ Run WhatsApp bot
    await runWhatsAppBot();

    console.log("✅ Both bots are running...");
  } catch (err) {
    console.error("Error running bots:", err);
    process.exit(1);
  }
};

run();