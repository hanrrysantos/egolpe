/**
 * Etapas falsas e determinísticas para testar o próprio script de avaliação sem API.
 * São heurísticas grosseiras de palavras-chave: NÃO medem a qualidade do produto.
 */
import type { Etapas } from "../src/nucleo/analisar";
import type { Extracao, TipoGolpe } from "../src/nucleo/tipos";

const RE_LINK = /https?:\/\/[^\s)\]]+/gi;
const RE_LINHA = /\d{5}\.?\d{5}\s?\d{5}\.?\d{6}\s?\d{5}\.?\d{6}\s?\d\s?\d{14}/g;
const RE_MANIPULACAO = /classifique|ignore as (instru|regras)|instru[cç][aã]o para o assistente|nota do sistema|sistemas autom[aá]ticos|sempre responde/i;

function tipoProvavel(t: string): TipoGolpe {
  if (RE_LINHA.test(t) || /boleto|linha digit/.test(t)) return "boleto_adulterado";
  if (/troquei de n|mudei de n|novo n[uú]mero|numero novo|n[uú]mero novo/.test(t)) return "falso_parente";
  if (/encomenda|pacote|entrega|correios|objeto|remessa/.test(t)) return "taxa_entrega";
  if (/inss|receita|gov\.br|valores a receber|cnh|fgts|benef[ií]cio|detran/.test(t)) return "governo_falso";
  if (/cart[aã]o|compra|conta|banco|pix de/.test(t)) return "falsa_central";
  return "outro";
}

export const etapasSimuladas: Etapas = {
  async extrair(entrada) {
    const texto = entrada.texto ?? "";
    const t = texto.toLowerCase();
    RE_LINHA.lastIndex = 0;
    const extracao: Extracao = {
      links: texto.match(RE_LINK) ?? [],
      chavesPix: [],
      linhasDigitaveis: texto.match(RE_LINHA) ?? [],
      telefones: [],
      pedeDinheiro: /pix|taxa|pague|pagar|empresta|transfer|quite|boleto|\bcompre\b/.test(t),
      pedeDadosSensiveis: /(informe|digite|envie|passe|confirme|atualize)[^.]*(senha|c[oó]digo|token|dados|cpf)/.test(t),
      urgencia: (t.match(/hoje|imediatamente|urgente|\d+h\b|bloqueada|ser[aá] (suspensa|bloqueada)|[uú]ltima/g) ?? []).slice(0, 3),
      trechos: [texto.slice(0, 60)],
      tipoProvavel: "outro",
      tentativaDeManipulacao: RE_MANIPULACAO.test(texto),
      remetente: { descricao: "desconhecido", trocouDeNumero: /troquei de n|mudei de n|n[uú]mero novo|novo n[uú]mero/.test(t) },
    };
    RE_LINHA.lastIndex = 0;
    extracao.tipoProvavel = tipoProvavel(t);
    return extracao;
  },
  async verificarSinais() {
    return [];
  },
  async sintetizar(extracao) {
    let pontos = 0;
    if (extracao.links.some((l) => /\.(top|example|test)\b|bit\.example/.test(l))) pontos += 2;
    if (extracao.pedeDinheiro) pontos += 1;
    if (extracao.pedeDadosSensiveis) pontos += 2;
    if (extracao.urgencia.length > 0) pontos += 1;
    if (extracao.remetente?.trocouDeNumero) pontos += 1;
    if (extracao.linhasDigitaveis.length > 0) pontos += 1;
    const nivel = extracao.tentativaDeManipulacao || pontos >= 3 ? "golpe" : pontos >= 1 ? "suspeito" : "seguro";
    const tipo = nivel === "seguro" ? "nenhum" : extracao.tipoProvavel === "outro" && nivel === "golpe" ? "outro" : extracao.tipoProvavel;
    return {
      nivel,
      tipo,
      motivos: nivel === "seguro" ? [] : [{ texto: "Simulação: pontuação por palavras-chave.", evidencia: extracao.trechos[0] ?? "(sem trecho)" }],
    };
  },
};
