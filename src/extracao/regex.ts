import { parse } from "tldts";
import type { ChavePix, Extracao, Telefone, TipoChavePix } from "@/src/nucleo/tipos";

/**
 * Reforço determinístico da extração: acha no texto o que é óbvio por formato
 * (links, telefones, linhas digitáveis, chaves Pix) e une com o que o modelo achou.
 * Não substitui o modelo (que também lê prints); só complementa.
 */

export interface AchadosRegex {
  links: string[];
  telefones: Telefone[];
  linhasDigitaveis: string[];
  chavesPix: ChavePix[];
}

// ---------------------------------------------------------------------------
// Linha digitável
// ---------------------------------------------------------------------------

/** Boleto bancário (47 dígitos): AAABC.CCCCX DDDDD.DDDDDY EEEEE.EEEEEZ K UUUUVVVVVVVVVV */
const RE_BOLETO =
  /(?<!\d)\d{5}[.\s]?\d{5}[\s.]*\d{5}[.\s]?\d{6}[\s.]*\d{5}[.\s]?\d{6}[\s.]*\d[\s.]*\d{14}(?!\d)/g;
/** Arrecadação/concessionária (48 dígitos): 4 blocos de 11 dígitos + DV. */
const RE_ARRECADACAO = /(?<!\d)(?:\d{11}[-\s]?\d[\s.]*){3}\d{11}[-\s]?\d(?!\d)/g;

// ---------------------------------------------------------------------------
// Telefones
// ---------------------------------------------------------------------------

/** 0800 / 0300 / 0500 / 0900 */
const RE_0800 = /(?<!\d)0[3589]00[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
/** 4004-0001, 3003 0001 (capitais e regiões metropolitanas) */
const RE_4004 = /(?<!\d)[34]00[0-9][\s.-]\d{4}(?!\d)/g;
/**
 * Fixo ou celular com DDD. Exige alguma formatação (+55, DDD entre parênteses ou separador),
 * para não confundir com CPF ou outros números de 11 dígitos sem pontuação.
 */
const RE_TELEFONE =
  /(?<![\d/])(?:\+?55[\s.-]?)?(?:\(\d{2}\)\s?|\d{2}[\s.-])9?\s?\d{4}[\s.-]?\d{4}(?![\d/])|(?<![\d/])\+55\s?\d{2}\s?9?\d{8}(?![\d/])/g;

const RE_CONTEXTO_LIGAR = /(lig(ue|ar|a)|entre em contato|chame|whats|zap|central|atendimento|telefone|contato)[^\n]{0,40}$/i;

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

const RE_LINK_COM_ESQUEMA = /\bhttps?:\/\/[^\s<>"'`]+/gi;
/** Domínio sem esquema: rótulos com letras/dígitos/hífen, ao menos um ponto, caminho opcional. */
const RE_LINK_SEM_ESQUEMA =
  /(?<![\p{L}\p{N}@._/-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?![\p{L}\p{N}-])(?::\d{2,5})?(?:\/[^\s<>"'`]*)?/giu;
/** TLDs reservados para testes e exemplos: aceitos para os casos sintéticos. */
const TLDS_RESERVADOS = new Set(["test", "example", "invalid", "localhost"]);
const PONTUACAO_FINAL = /[.,;:!?)\]}"'”’»…]+$/;

// ---------------------------------------------------------------------------
// Chaves Pix
// ---------------------------------------------------------------------------

const RE_CPF = /(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?![\d.-])/g;
const RE_CNPJ = /(?<![\d.])\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?![\d-])/g;
const RE_ALEATORIA = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const RE_EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;
const RE_MENCIONA_PIX = /\bpix\b|\bchave\b/i;

// ---------------------------------------------------------------------------

export function soDigitos(s: string): string {
  return s.replace(/\D/g, "");
}

/** Remove os trechos já reconhecidos, para um padrão não achar pedaços de outro. */
function apagar(texto: string, re: RegExp): { achados: string[]; resto: string } {
  const achados: string[] = [];
  const resto = texto.replace(re, (m) => {
    achados.push(m.trim());
    return " ".repeat(m.length);
  });
  return { achados, resto };
}

function hostValido(host: string): boolean {
  const h = host.toLowerCase();
  const tld = h.split(".").pop() ?? "";
  if (TLDS_RESERVADOS.has(tld)) return true;
  const p = parse(h);
  return p.isIcann === true && p.domain !== null;
}

export function acharLinks(texto: string): string[] {
  const { achados: comEsquema, resto } = apagar(texto, RE_LINK_COM_ESQUEMA);
  const semEmails = resto.replace(RE_EMAIL, (m) => " ".repeat(m.length));
  const links: string[] = [];
  for (const bruto of comEsquema) links.push(bruto.replace(PONTUACAO_FINAL, ""));
  for (const m of semEmails.matchAll(RE_LINK_SEM_ESQUEMA)) {
    const link = m[0].replace(PONTUACAO_FINAL, "");
    const host = link.split(/[/:]/)[0] ?? "";
    if (hostValido(host)) links.push(link);
  }
  return links;
}

export function acharLinhasDigitaveis(texto: string): { linhas: string[]; resto: string } {
  const boletos = apagar(texto, RE_BOLETO);
  const arrecadacao = apagar(boletos.resto, RE_ARRECADACAO);
  const linhas = [...boletos.achados, ...arrecadacao.achados].filter((l) => {
    const n = soDigitos(l).length;
    return n === 47 || n === 48;
  });
  return { linhas, resto: arrecadacao.resto };
}

export function acharTelefones(texto: string): Telefone[] {
  const achados: { indice: number; telefone: Telefone }[] = [];
  let resto = texto;
  // Do padrão mais longo para o mais curto, apagando o que já foi achado:
  // assim "3000-0000" dentro de "(11) 3000-0000" não vira um 3003/4004.
  for (const re of [RE_TELEFONE, RE_0800, RE_4004]) {
    for (const m of resto.matchAll(re)) {
      const numero = m[0].trim();
      const n = soDigitos(numero).length;
      if (re === RE_TELEFONE && (n < 10 || n > 13)) continue;
      const indice = m.index ?? 0;
      const antes = texto.slice(Math.max(0, indice - 60), indice);
      achados.push({ indice, telefone: { numero, contexto: RE_CONTEXTO_LIGAR.test(antes) ? "ligar_para" : "outro" } });
    }
    resto = resto.replace(re, (m) => " ".repeat(m.length));
  }
  return achados.sort((a, b) => a.indice - b.indice).map((a) => a.telefone);
}

export function acharChavesPix(texto: string): ChavePix[] {
  if (!RE_MENCIONA_PIX.test(texto)) return [];
  const chaves: ChavePix[] = [];
  const add = (re: RegExp, tipo: TipoChavePix) => {
    for (const m of texto.matchAll(re)) chaves.push({ valor: m[0], tipo });
  };
  add(RE_CNPJ, "cnpj");
  add(RE_CPF, "cpf");
  add(RE_ALEATORIA, "aleatoria");
  add(RE_EMAIL, "email");
  return chaves;
}

/** Roda todos os padrões sobre o texto da entrada. */
export function extrairPorRegex(texto: string): AchadosRegex {
  const { linhas, resto } = acharLinhasDigitaveis(texto);
  const restoSemPix = resto.replace(RE_CNPJ, (m) => " ".repeat(m.length)).replace(RE_CPF, (m) => " ".repeat(m.length));
  return {
    linhasDigitaveis: linhas,
    links: acharLinks(resto),
    telefones: acharTelefones(restoSemPix.replace(RE_LINK_COM_ESQUEMA, (m) => " ".repeat(m.length))),
    chavesPix: acharChavesPix(resto),
  };
}

// ---------------------------------------------------------------------------
// União sem duplicar
// ---------------------------------------------------------------------------

/** Chave de comparação de links: sem esquema, sem "www.", host em minúsculas, sem barra final. */
export function chaveLink(link: string): string {
  const semEsquema = link.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "");
  const corte = semEsquema.search(/[/?#]/);
  const host = (corte === -1 ? semEsquema : semEsquema.slice(0, corte)).toLowerCase();
  const caminho = corte === -1 ? "" : semEsquema.slice(corte);
  return (host + caminho).replace(/\/+$/, "");
}

/** Chave de comparação de telefones: só dígitos, sem o 55 do país. */
export function chaveTelefone(numero: string): string {
  const d = soDigitos(numero);
  return (d.length === 12 || d.length === 13) && d.startsWith("55") ? d.slice(2) : d;
}

export function chaveChavePix(c: ChavePix): string {
  const v = c.valor.trim();
  return /^[\d.\-/\s()+]+$/.test(v) ? soDigitos(v) : v.toLowerCase();
}

function unir<T>(base: T[], extras: T[], chave: (x: T) => string): T[] {
  const vistos = new Set(base.map(chave));
  const saida = [...base];
  for (const x of extras) {
    const k = chave(x);
    if (k === "" || vistos.has(k)) continue;
    vistos.add(k);
    saida.push(x);
  }
  return saida;
}

/** Une o que o modelo achou com o que a regex achou. O que veio do modelo tem prioridade. */
export function unirComRegex(extracao: Extracao, achados: AchadosRegex): Extracao {
  return {
    ...extracao,
    links: unir(extracao.links, achados.links, chaveLink),
    telefones: unir(extracao.telefones, achados.telefones, (t) => chaveTelefone(t.numero)),
    linhasDigitaveis: unir(extracao.linhasDigitaveis, achados.linhasDigitaveis, soDigitos),
    chavesPix: unir(extracao.chavesPix, achados.chavesPix, chaveChavePix),
  };
}
