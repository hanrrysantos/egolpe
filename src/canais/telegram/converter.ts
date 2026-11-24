import type { Entrada, Imagem, TipoMimeImagem } from "@/src/nucleo/tipos";
import type { TgMensagem } from "./tipos";

/** Tamanho máximo de imagem aceita (bytes). */
export const LIMITE_IMAGEM_BYTES = 5 * 1024 * 1024;

const MIMES_IMAGEM: readonly TipoMimeImagem[] = ["image/jpeg", "image/png", "image/webp"];

export interface ArquivoImagem {
  fileId: string;
  mime: TipoMimeImagem;
}

/** O que fazer com uma mensagem recebida (decisão pura, sem rede). */
export type Classificacao =
  | { tipo: "comando"; comando: "start" | "ajuda" }
  | { tipo: "analisar"; texto?: string; imagem?: ArquivoImagem }
  /** Voz, áudio, vídeo ou vídeo-nota: fora do MVP. */
  | { tipo: "midia_nao_suportada" }
  | { tipo: "imagem_grande" }
  /** Sticker, contato etc. */
  | { tipo: "outro" };

function comandoDe(texto: string): "start" | "ajuda" | undefined {
  // "/start", "/start@egolpe_bot", "/start payload"
  const m = /^\/(start|ajuda|help)(?:@\w+)?(?:\s|$)/i.exec(texto.trim());
  if (!m) return undefined;
  return m[1]!.toLowerCase() === "start" ? "start" : "ajuda";
}

function limpar(t: string | undefined): string | undefined {
  const v = t?.trim();
  return v ? v : undefined;
}

export function classificarMensagem(msg: TgMensagem): Classificacao {
  if (msg.voice || msg.audio || msg.video || msg.video_note || msg.animation) {
    return { tipo: "midia_nao_suportada" };
  }

  const texto = limpar(msg.text);
  if (texto) {
    const comando = comandoDe(texto);
    if (comando) return { tipo: "comando", comando };
    return { tipo: "analisar", texto };
  }

  const legenda = limpar(msg.caption);

  if (msg.photo && msg.photo.length > 0) {
    // Maior tamanho que ainda cabe no limite.
    const ok = msg.photo
      .filter((p) => p.file_size === undefined || p.file_size <= LIMITE_IMAGEM_BYTES)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!ok) return { tipo: "imagem_grande" };
    return { tipo: "analisar", texto: legenda, imagem: { fileId: ok.file_id, mime: "image/jpeg" } };
  }

  if (msg.document) {
    const mime = msg.document.mime_type?.toLowerCase();
    if (mime && (MIMES_IMAGEM as readonly string[]).includes(mime)) {
      if (msg.document.file_size !== undefined && msg.document.file_size > LIMITE_IMAGEM_BYTES) {
        return { tipo: "imagem_grande" };
      }
      return {
        tipo: "analisar",
        texto: legenda,
        imagem: { fileId: msg.document.file_id, mime: mime as TipoMimeImagem },
      };
    }
  }

  return { tipo: "outro" };
}

export function bytesParaBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Monta a Entrada comum do núcleo. `imagem` já deve estar baixada e dentro do limite. */
export function montarEntrada(texto: string | undefined, imagem?: Imagem): Entrada {
  return { ...(texto ? { texto } : {}), imagens: imagem ? [imagem] : [] };
}
