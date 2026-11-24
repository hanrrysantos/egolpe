import type { TecladoInline } from "./tipos";

/** Operações da Bot API de que o adaptador precisa. Injetável nos testes. */
export interface ApiTelegram {
  enviarMensagem(chatId: number, html: string, teclado?: TecladoInline): Promise<number | undefined>;
  editarMensagem(chatId: number, messageId: number, html: string, teclado?: TecladoInline): Promise<boolean>;
  digitando(chatId: number): Promise<void>;
  responderCallback(callbackId: string): Promise<void>;
  /** Baixa um arquivo pelo file_id. Devolve null se falhar. */
  baixarArquivo(fileId: string, opcoes?: { tamanhoObrigatorio?: boolean }): Promise<Uint8Array | null>;
}

const BASE = "https://api.telegram.org";

/** Prazo de cada chamada à Bot API. */
export const TIMEOUT_API_MS = 5_000;
/** Prazo do download do arquivo. */
export const TIMEOUT_DOWNLOAD_MS = 8_000;
/** Tamanho máximo aceito para download (5 MB). */
export const LIMITE_DOWNLOAD_BYTES = 5 * 1024 * 1024;

/** Lê o corpo em streaming e aborta (devolve null) ao passar do limite. */
export async function lerCorpoLimitado(resp: Response, limite: number): Promise<Uint8Array | null> {
  const declarado = Number(resp.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > limite) {
    await resp.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!resp.body) return null;
  const leitor = resp.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > limite) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    partes.push(value);
  }
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}

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
      signal: AbortSignal.timeout(TIMEOUT_API_MS),
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
    async baixarArquivo(fileId, opcoes) {
      try {
        const info = (await chamar("getFile", { file_id: fileId })) as { file_path?: string; file_size?: number };
        if (!info?.file_path) return null;
        if (info.file_size === undefined ? opcoes?.tamanhoObrigatorio : info.file_size > LIMITE_DOWNLOAD_BYTES) {
          return null;
        }
        const resp = await f(`${BASE}/file/bot${token}/${info.file_path}`, {
          signal: AbortSignal.timeout(TIMEOUT_DOWNLOAD_MS),
        });
        if (!resp.ok) return null;
        return await lerCorpoLimitado(resp, LIMITE_DOWNLOAD_BYTES);
      } catch {
        return null;
      }
    },
  };
}
