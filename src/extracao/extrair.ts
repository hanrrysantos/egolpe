import type Anthropic from "@anthropic-ai/sdk";
import type { Entrada, Extracao, ModeloClaude } from "@/src/nucleo/tipos";
import { chamarModeloJson } from "./modelo";
import { montarConteudoExtracao, SISTEMA_EXTRACAO } from "./prompt";
import { chaveChavePix, chaveLink, chaveTelefone, extrairPorRegex, soDigitos, unirComRegex } from "./regex";
import { jsonSchemaExtracao, paraExtracao, schemaExtracaoModelo } from "./schema";
import { normalizar } from "./texto";

export interface DepsModelo {
  cliente: Anthropic;
  modelo: ModeloClaude;
  /** Sinal para cancelar a chamada quando o prazo da análise acabar. */
  signal?: AbortSignal;
}

/** Folga para o raciocínio (esforço baixo) mais o JSON da extração. */
const MAX_TOKENS_EXTRACAO = 4096;

/**
 * Etapa 1: transforma o conteúdo bruto em dados estruturados.
 * Lança erro em falha da API, recusa ou saída inválida (o núcleo converte em veredito de falha).
 */
export async function extrair(entrada: Entrada, deps: DepsModelo): Promise<Extracao> {
  const doModelo = await chamarModeloJson({
    cliente: deps.cliente,
    modelo: deps.modelo,
    signal: deps.signal,
    system: SISTEMA_EXTRACAO,
    conteudo: montarConteudoExtracao(entrada),
    schemaJson: jsonSchemaExtracao,
    schemaZod: schemaExtracaoModelo,
    maxTokens: MAX_TOKENS_EXTRACAO,
  });

  let extracao = paraExtracao(doModelo);
  const texto = entrada.texto ?? "";
  // Sem imagens, tudo o que o modelo diz ter lido precisa estar no texto: descarta o que ele inventou.
  if (entrada.imagens.length === 0) extracao = manterSoOQueEstaNoTexto(extracao, texto);
  if (texto.trim()) extracao = unirComRegex(extracao, extrairPorRegex(texto));
  return extracao;
}

/** Caracteres que, colados antes do host, mostram que ele é pedaço de outro host ou de um e-mail. */
const ANTES_PROIBIDO = /[\p{L}\p{N}@._-]/u;
/** Colados depois do host, mostram que ele continua (ex.: "caixa.gov.br-seguro.test"). */
const DEPOIS_PROIBIDO = /[\p{L}\p{N}_-]/u;

/**
 * O host aparece no texto como host inteiro, e não como pedaço de outro?
 * "caixa.gov.br" não está em "caixa.gov.br.golpe.top" nem em "caixa.gov.br-seguro.test",
 * mas está em "acesse caixa.gov.br." (ponto final da frase) e em "https://www.caixa.gov.br/x".
 */
export function hostNoTexto(host: string, textoMinusculo: string): boolean {
  const h = host.toLowerCase();
  if (h === "") return false;
  for (let i = textoMinusculo.indexOf(h); i !== -1; i = textoMinusculo.indexOf(h, i + 1)) {
    let inicio = i;
    // "www." antes do host é aceito (a chave do link não tem "www.").
    if (textoMinusculo.slice(Math.max(0, i - 4), i) === "www.") inicio = i - 4;
    const antes = textoMinusculo[inicio - 1] ?? "";
    const fim = i + h.length;
    const depois = textoMinusculo[fim] ?? "";
    const depoisDoPonto = textoMinusculo[fim + 1] ?? "";
    const antesOk = antes === "" || !ANTES_PROIBIDO.test(antes);
    const depoisOk =
      depois === "" || (depois === "." ? !DEPOIS_PROIBIDO.test(depoisDoPonto) : !DEPOIS_PROIBIDO.test(depois));
    if (antesOk && depoisOk) return true;
  }
  return false;
}

/**
 * Remove da extração itens que não aparecem no texto (alucinação ou manipulação).
 * Importante para a síntese: trechos e links viram evidência, e um link inventado
 * do domínio oficial poderia sustentar um 🟢 falso.
 */
export function manterSoOQueEstaNoTexto(extracao: Extracao, texto: string): Extracao {
  const t = normalizar(texto);
  const tMinusculo = texto.toLowerCase();
  const digitos = soDigitos(texto);
  const estaNoTexto = (s: string) => {
    const n = normalizar(s);
    return n !== "" && t.includes(n);
  };
  const digitosNoTexto = (s: string) => {
    const d = soDigitos(s);
    return d.length >= 8 && digitos.includes(d);
  };

  return {
    ...extracao,
    links: extracao.links.filter((l) => hostNoTexto(chaveLink(l).split(/[/:?#]/)[0] ?? "", tMinusculo)),
    telefones: extracao.telefones.filter((tel) => digitosNoTexto(chaveTelefone(tel.numero))),
    linhasDigitaveis: extracao.linhasDigitaveis.filter(digitosNoTexto),
    chavesPix: extracao.chavesPix.filter((c) => {
      const k = chaveChavePix(c);
      return /^\d+$/.test(k) ? digitosNoTexto(k) : tMinusculo.includes(k);
    }),
    trechos: extracao.trechos.filter(estaNoTexto),
    urgencia: extracao.urgencia.filter(estaNoTexto),
    ...(extracao.valor !== undefined && !estaNoTexto(extracao.valor) ? { valor: undefined } : {}),
  };
}
