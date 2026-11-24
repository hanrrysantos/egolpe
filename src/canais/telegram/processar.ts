import { analisar as analisarNucleo } from "@/src/nucleo/analisar";
import { descreverErro } from "@/src/nucleo/log";
import { ORIENTACAO_BASICA, passosDepois } from "@/src/nucleo/roteiros";
import type { Entrada, Imagem, Veredito } from "@/src/nucleo/tipos";
import { mensagemLimite, verificarLimite, type DepsLimite, type ResultadoLimite } from "@/src/limite/limite";
import type { ApiTelegram } from "./api";
import { bytesParaBase64, classificarMensagem, LIMITE_IMAGEM_BYTES, montarEntrada, type ArquivoImagem } from "./converter";
import {
  escaparHtml,
  formatarDepois,
  formatarOrientacaoBasica,
  formatarVeredito,
  MSG_ANALISANDO,
  MSG_AUDIO,
  MSG_BOAS_VINDAS,
  MSG_FALHA_IMAGEM,
  MSG_IMAGEM_GRANDE,
  MSG_OUTRO,
  tipoDoCallback,
} from "./formatar";
import type { TgCallbackQuery, TgMensagem, TgUpdate } from "./tipos";

/** Orçamento da função na Vercel (maxDuration da rota). */
export const ORCAMENTO_TOTAL_MS = 60_000;
/** Folga reservada para formatar e enviar o veredito. */
export const FOLGA_RESPOSTA_MS = 11_000;
/** Prazo mínimo para valer a pena analisar. */
export const PRAZO_MINIMO_MS = 15_000;

/** Prazo para o núcleo, ou null se não sobrar tempo suficiente. */
export function calcularPrazoAnaliseMs(decorridoMs: number): number | null {
  const prazo = ORCAMENTO_TOTAL_MS - decorridoMs - FOLGA_RESPOSTA_MS;
  return prazo >= PRAZO_MINIMO_MS ? prazo : null;
}

export interface DepsProcessar {
  api: ApiTelegram;
  analisar: (entrada: Entrada, opcoes: { timeoutMs: number }) => Promise<Veredito>;
  limite: (usuarioId: number) => Promise<ResultadoLimite>;
  /** Instante (Date.now) em que o webhook começou a tratar a requisição. */
  inicio?: number;
  /** Relógio injetável (Date.now). */
  agora?: () => number;
}

/** Dependências reais (produção). */
export function depsPadrao(api: ApiTelegram, limite: DepsLimite, inicio?: number): DepsProcessar {
  return {
    api,
    inicio,
    analisar: (e, o) => analisarNucleo(e, { timeoutMs: o.timeoutMs }),
    limite: (id) => verificarLimite(id, limite),
  };
}

async function obterImagem(api: ApiTelegram, arq: ArquivoImagem): Promise<Imagem | null> {
  const bytes = await api.baixarArquivo(arq.fileId, { tamanhoObrigatorio: arq.documento === true });
  if (!bytes || bytes.length === 0 || bytes.length > LIMITE_IMAGEM_BYTES) return null;
  return { mime: arq.mime, base64: bytesParaBase64(bytes) };
}

async function processarMensagem(msg: TgMensagem, deps: DepsProcessar): Promise<void> {
  // Só conversa direta; grupos e canais são ignorados.
  if (msg.chat.type !== "private") return;
  const chatId = msg.chat.id;
  const { api } = deps;
  const c = classificarMensagem(msg);

  switch (c.tipo) {
    case "comando":
      await api.enviarMensagem(chatId, escaparHtml(MSG_BOAS_VINDAS));
      return;
    case "midia_nao_suportada":
      await api.enviarMensagem(chatId, escaparHtml(MSG_AUDIO));
      return;
    case "imagem_grande":
      await api.enviarMensagem(chatId, escaparHtml(MSG_IMAGEM_GRANDE));
      return;
    case "outro":
      await api.enviarMensagem(chatId, escaparHtml(MSG_OUTRO));
      return;
    case "analisar":
      break;
  }

  const usuarioId = msg.from?.id ?? chatId;
  const lim = await deps.limite(usuarioId);
  if (!lim.permitido) {
    await api.enviarMensagem(chatId, formatarOrientacaoBasica(mensagemLimite(lim), ORIENTACAO_BASICA));
    return;
  }

  const agora = deps.agora ?? Date.now;
  const inicio = deps.inicio ?? agora();
  // Melhor esforço: falha nestes avisos não pode impedir a análise.
  await api.digitando(chatId).catch(() => undefined);
  const idAnalisando = await api.enviarMensagem(chatId, escaparHtml(MSG_ANALISANDO)).catch(() => undefined);

  let imagem: Imagem | undefined;
  if (c.imagem) {
    const baixada = await obterImagem(api, c.imagem);
    if (!baixada) {
      await responder(api, chatId, idAnalisando, escaparHtml(MSG_FALHA_IMAGEM));
      return;
    }
    imagem = baixada;
  }

  const prazo = calcularPrazoAnaliseMs(agora() - inicio);
  if (prazo === null) {
    await responder(
      api,
      chatId,
      idAnalisando,
      formatarOrientacaoBasica("Está demorando mais do que o normal e não consegui analisar.", ORIENTACAO_BASICA),
    );
    return;
  }

  const veredito = await deps.analisar(montarEntrada(c.texto, imagem), { timeoutMs: prazo });
  const { texto, teclado } = formatarVeredito(veredito);
  await responder(api, chatId, idAnalisando, texto, teclado);
}

/** Edita a mensagem "Analisando…"; se não der, manda uma nova. */
async function responder(
  api: ApiTelegram,
  chatId: number,
  idAnalisando: number | undefined,
  html: string,
  teclado?: Parameters<ApiTelegram["enviarMensagem"]>[2],
): Promise<void> {
  if (idAnalisando !== undefined && (await api.editarMensagem(chatId, idAnalisando, html, teclado))) return;
  await api.enviarMensagem(chatId, html, teclado);
}

async function processarCallback(cb: TgCallbackQuery, deps: DepsProcessar): Promise<void> {
  const { api } = deps;
  await api.responderCallback(cb.id);
  const chat = cb.message?.chat;
  if (!chat || chat.type !== "private") return;
  const tipo = tipoDoCallback(cb.data);
  if (!tipo) return;
  await api.enviarMensagem(chat.id, formatarDepois(passosDepois(tipo)));
}

/**
 * Trata um update do Telegram. Nunca lança: erros viram log só com o nome do erro
 * (a mensagem do erro pode conter conteúdo do usuário ou o token).
 */
export async function processarUpdate(update: TgUpdate, deps: DepsProcessar): Promise<void> {
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  try {
    if (update.message) await processarMensagem(update.message, deps);
    else if (update.callback_query) await processarCallback(update.callback_query, deps);
  } catch (e) {
    console.error(JSON.stringify({ evento: "telegram_erro", erro: descreverErro(e) }));
    if (chatId !== undefined && update.message) {
      // Melhor esforço: a pessoa nunca fica sem resposta.
      await deps.api
        .enviarMensagem(
          chatId,
          formatarOrientacaoBasica("Não consegui analisar agora.", ORIENTACAO_BASICA),
        )
        .catch(() => undefined);
    }
  }
}
