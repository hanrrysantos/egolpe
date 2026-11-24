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
    links: extracao.links.filter((l) => {
      const k = chaveLink(l);
      const host = k.split("/")[0] ?? "";
      return host !== "" && tMinusculo.includes(host);
    }),
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
