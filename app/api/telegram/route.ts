import { after } from "next/server";
import { criarApiTelegram } from "@/src/canais/telegram/api";
import { depsPadrao, processarUpdate } from "@/src/canais/telegram/processar";
import { segredoValido } from "@/src/canais/telegram/segredo";
import type { TgUpdate } from "@/src/canais/telegram/tipos";
import { criarArmazenamentoUpstash } from "@/src/limite/limite";
import { descreverErro } from "@/src/nucleo/log";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const inicio = Date.now();
  if (!segredoValido(req.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response("unauthorized", { status: 401 });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error(JSON.stringify({ evento: "telegram_erro", erro: "token_ausente" }));
    return new Response("ok");
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // Responde 200 já, para o Telegram não reenviar; o trabalho continua depois.
  after(async () => {
    try {
      const deps = depsPadrao(
        criarApiTelegram(token),
        {
          armazenamento: criarArmazenamentoUpstash(),
          aoFalhar: (erro) => console.warn(JSON.stringify({ evento: "limite_falha", erro })),
        },
        inicio,
      );
      await processarUpdate(update, deps);
    } catch (e) {
      console.error(JSON.stringify({ evento: "telegram_erro", erro: descreverErro(e) }));
    }
  });

  return new Response("ok");
}
