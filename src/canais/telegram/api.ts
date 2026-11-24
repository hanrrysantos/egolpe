import type { TecladoInline } from "./tipos";

/** Operações da Bot API de que o adaptador precisa. Injetável nos testes. */
export interface ApiTelegram {
  enviarMensagem(chatId: number, html: string, teclado?: TecladoInline): Promise<number | undefined>;
  editarMensagem(chatId: number, messageId: number, html: string, teclado?: TecladoInline): Promise<boolean>;
  digitando(chatId: number): Promise<void>;
  responderCallback(callbackId: string): Promise<void>;
  /** Baixa um arquivo pelo file_id. Devolve null se falhar. */
  baixarArquivo(fileId: string): Promise<Uint8Array | null>;
}

const BASE = "https://api.telegram.org";

/**
 * Cliente da Bot API via fetch. O token fica na URL, por isso erros daqui
 * nunca devem ser logados com a mensagem original (só o nome do erro).
 */
export function criarApiTelegram(token: string, f: typeof fetch = fetch): ApiTelegram {
  async function chamar(metodo: string, corpo: Record<string, unknown>): Promise<unknown> {
    const resp = await f(`${BASE}/bot${token}/${metodo}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const json = (await resp.json().catch(() => null)) as { ok?: boolean; result?: unknown } | null;
    if (!resp.ok || !json?.ok) throw new Error(`telegram_${metodo}_falhou`);
    return json.result;
  }

  return {
    async enviarMensagem(chatId, html, teclado) {
      const r = await chamar("sendMessage", {
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(teclado ? { reply_markup: teclado } : {}),
      });
      return (r as { message_id?: number } | undefined)?.message_id;
    },
    async editarMensagem(chatId, messageId, html, teclado) {
      try {
        await chamar("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: html,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...(teclado ? { reply_markup: teclado } : {}),
        });
        return true;
      } catch {
        return false;
      }
    },
    async digitando(chatId) {
      await chamar("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
    },
    async responderCallback(callbackId) {
      await chamar("answerCallbackQuery", { callback_query_id: callbackId }).catch(() => undefined);
    },
    async baixarArquivo(fileId) {
      try {
        const info = (await chamar("getFile", { file_id: fileId })) as { file_path?: string };
        if (!info?.file_path) return null;
        const resp = await f(`${BASE}/file/bot${token}/${info.file_path}`);
        if (!resp.ok) return null;
        return new Uint8Array(await resp.arrayBuffer());
      } catch {
        return null;
      }
    },
  };
}
