import type { Nivel, TipoGolpe, Veredito } from "@/src/nucleo/tipos";
import type { TecladoInline } from "./tipos";

const TIPOS_GOLPE: readonly TipoGolpe[] = [
  "falso_parente",
  "falsa_central",
  "taxa_entrega",
  "boleto_adulterado",
  "governo_falso",
  "outro",
  "nenhum",
];

const MAX_MENSAGEM = 3900; // limite do Telegram é 4096
const PREFIXO_CALLBACK = "depois:";

/** Escapa o texto para parse_mode HTML. Obrigatório para tudo que vem do veredito. */
export function escaparHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const TITULO: Record<Nivel, string> = {
  seguro: "🟢 <b>Parece seguro.</b>",
  suspeito: "🟡 <b>Cuidado: isso parece suspeito.</b>",
  golpe: "🔴 <b>Isso é golpe.</b>",
};

export function dadosCallbackDepois(tipo: TipoGolpe): string {
  return `${PREFIXO_CALLBACK}${tipo}`;
}

/** Valida o callback_data (vem do cliente, não é confiável). Devolve o tipo ou null. */
export function tipoDoCallback(data: string | undefined): TipoGolpe | null {
  if (!data || !data.startsWith(PREFIXO_CALLBACK)) return null;
  const tipo = data.slice(PREFIXO_CALLBACK.length);
  return (TIPOS_GOLPE as readonly string[]).includes(tipo) ? (tipo as TipoGolpe) : null;
}

function numerar(passos: string[]): string {
  return passos.map((p, i) => `${i + 1}. ${escaparHtml(p)}`).join("\n");
}

export interface MensagemFormatada {
  texto: string;
  teclado?: TecladoInline;
}

/** Veredito -> mensagem HTML do Telegram. Função pura. */
export function formatarVeredito(v: Veredito): MensagemFormatada {
  const partes: string[] = [TITULO[v.nivel]];

  if (v.motivos.length > 0) {
    partes.push("Por quê:");
  }
  const blocosMotivos = v.motivos.map(
    (m) => `• ${escaparHtml(m.texto)}\n   <i>${escaparHtml(m.evidencia)}</i>`,
  );

  let rodape: string;
  if (v.o_que_fazer.length > 0) {
    rodape = `<b>O que fazer agora:</b>\n${numerar(v.o_que_fazer)}`;
  } else if (v.nivel === "seguro") {
    rodape = "Mesmo assim, na dúvida, não faça Pix nem passe senha ou código. Pode me mandar de novo se desconfiar.";
  } else {
    rodape = "";
  }

  // Garante que cabe em uma mensagem: tira motivos do fim até caber.
  const montar = (n: number): string => {
    const lista = blocosMotivos.slice(0, n).join("\n\n");
    return [partes.join("\n\n"), lista, rodape].filter(Boolean).join("\n\n");
  };
  let n = blocosMotivos.length;
  let texto = montar(n);
  while (texto.length > MAX_MENSAGEM && n > 0) {
    n--;
    texto = montar(n);
  }
  if (texto.length > MAX_MENSAGEM) texto = texto.slice(0, MAX_MENSAGEM);

  const teclado: TecladoInline | undefined =
    v.nivel === "seguro"
      ? undefined
      : { inline_keyboard: [[{ text: "Já paguei / já cliquei", callback_data: dadosCallbackDepois(v.tipo) }]] };

  return { texto, teclado };
}

/** Mensagem do botão "Já paguei / já cliquei". */
export function formatarDepois(passos: string[]): string {
  return `<b>Calma, ainda dá para agir. Faça nesta ordem:</b>\n${numerar(passos)}`;
}

export function formatarOrientacaoBasica(introducao: string, passos: string[]): string {
  return `${escaparHtml(introducao)}\n\n<b>Enquanto isso:</b>\n${numerar(passos)}`;
}

export const MSG_BOAS_VINDAS = [
  "Olá! Eu ajudo a descobrir se uma mensagem é golpe.",
  "",
  "Como usar:",
  "1. Encaminhe para mim a mensagem que você recebeu, ou",
  "2. Mande um print da conversa, ou",
  "3. Cole aqui o texto ou o link.",
  "",
  "Eu respondo em poucos segundos. Nada do que você me manda fica guardado.",
  "",
  "Eu nunca peço sua senha, código de verificação ou dados do cartão.",
].join("\n");

export const MSG_AUDIO = "Por enquanto eu só entendo texto e print. Pode me mandar a mensagem escrita ou uma foto da tela?";

export const MSG_OUTRO = "Não consegui ler isso. Encaminhe a mensagem, mande um print ou cole o texto ou o link aqui.";

export const MSG_IMAGEM_GRANDE = "Essa imagem é muito grande para mim. Tente mandar um print menor ou cole o texto aqui.";

export const MSG_FALHA_IMAGEM = "Não consegui abrir essa imagem. Tente mandar de novo ou cole o texto aqui.";

export const MSG_ANALISANDO = "Analisando… isso leva alguns segundos.";

export const MSG_SO_PRIVADO = "Eu funciono só em conversa direta comigo. Me chame no privado.";
