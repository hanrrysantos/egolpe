/**
 * Registra o webhook do bot no Telegram.
 * Uso: npx tsx scripts/configurar-webhook.ts https://seu-projeto.vercel.app
 * Lê TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET do ambiente (ou do .env).
 */
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const base = process.argv[2];
const token = process.env.TELEGRAM_BOT_TOKEN;
const segredo = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!base || !/^https:\/\//.test(base)) {
  console.error("Informe a URL base com https. Ex.: npx tsx scripts/configurar-webhook.ts https://meu-app.vercel.app");
  process.exit(1);
}
if (!token || !segredo) {
  console.error("Defina TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET no ambiente ou no .env.");
  process.exit(1);
}

const url = `${base.replace(/\/+$/, "")}/api/telegram`;
const resp = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: segredo,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  }),
});
const json = (await resp.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
if (!resp.ok || !json?.ok) {
  console.error(`Falhou: ${json?.description ?? resp.status}`);
  process.exit(1);
}
console.log(`Webhook configurado em ${url}`);
