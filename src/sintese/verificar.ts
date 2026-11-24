import { normalizar } from "@/src/extracao/texto";
import { impedimentosDeSeguro, type ResultadoSintese } from "@/src/nucleo/guardas";
import type { Evidencia, Extracao, Motivo } from "@/src/nucleo/tipos";
import type { SinteseModelo } from "./prompt";

export const MAX_MOTIVOS = 4;
const MAX_TEXTO_MOTIVO = 300;
/** Citação parcial de um trecho da mensagem: curta demais ("a", "pix") casaria com qualquer coisa. */
const MIN_CITACAO_PARCIAL = 8;
const MIN_PALAVRAS_CITACAO_PARCIAL = 2;
/** Parte mínima da descrição de um sinal que a citação precisa cobrir. */
const COBERTURA_MIN_SINAL = 0.9;
/** Quando a citação tem texto em volta da fonte, a fonte precisa ser a maior parte dela. */
const PROPORCAO_MIN_FONTE = 0.6;

/** Tudo o que pode ser citado como evidência, separado pelo quanto pode ser citado em parte. */
export interface FontesDeEvidencia {
  /** Trechos literais da mensagem (trechos, urgência, valor): aceitam citação parcial. */
  trechos: string[];
  /** Links, chaves Pix, telefones e linhas digitáveis: só citados inteiros. */
  itens: string[];
  /** Descrições de alertas e confirmações dos sinais: só citadas inteiras (ou quase). */
  sinais: string[];
}

function normalizarTodas(lista: string[]): string[] {
  return lista.map(normalizar).filter((f) => f.length > 0);
}

export function fontesDeEvidencia(extracao: Extracao, evidencias: Evidencia[]): FontesDeEvidencia {
  return {
    trechos: normalizarTodas([...extracao.trechos, ...extracao.urgencia, ...(extracao.valor ? [extracao.valor] : [])]),
    itens: normalizarTodas([
      ...extracao.links,
      ...extracao.chavesPix.map((c) => c.valor),
      ...extracao.telefones.map((t) => t.numero),
      ...extracao.linhasDigitaveis,
    ]),
    // "neutro" e "sem_resultado" não sustentam nada.
    sinais: normalizarTodas(
      evidencias.filter((e) => e.resultado === "alerta" || e.resultado === "confirmacao").map((e) => e.descricao),
    ),
  };
}

/** A citação contém a fonte inteira, com no máximo um pouco de texto em volta. */
function contemFonteInteira(ev: string, f: string): boolean {
  return ev.includes(f) && f.length >= ev.length * PROPORCAO_MIN_FONTE;
}

/**
 * A evidência do motivo está nas fontes?
 * - trecho da mensagem: citação parcial com pelo menos 8 caracteres e 2 palavras, ou o trecho inteiro;
 * - link, Pix, telefone, linha digitável: o item inteiro;
 * - descrição de sinal: a descrição inteira, ou uma citação que cubra pelo menos 90% dela.
 *   Pedaços de descrição mudam o sentido: "o da central oficial do Itaú" sai de
 *   "esse número não é o da central oficial do Itaú".
 */
export function evidenciaSustentada(evidencia: string, fontes: FontesDeEvidencia): boolean {
  const ev = normalizar(evidencia.replace(/\\u003c/gi, "<").replace(/\\u003e/gi, ">"));
  if (ev.length === 0) return false;
  const parcialOk = ev.length >= MIN_CITACAO_PARCIAL && ev.split(" ").length >= MIN_PALAVRAS_CITACAO_PARCIAL;
  return (
    fontes.trechos.some((f) => contemFonteInteira(ev, f) || (parcialOk && f.includes(ev))) ||
    fontes.itens.some((f) => contemFonteInteira(ev, f)) ||
    fontes.sinais.some((f) => contemFonteInteira(ev, f) || (f.includes(ev) && ev.length >= f.length * COBERTURA_MIN_SINAL))
  );
}

/**
 * Verificação em código da saída do modelo (antes de `aplicarGuardas`, que o núcleo roda depois):
 * - descarta motivos cuja evidência não está na extração nem nas descrições de alerta/confirmação;
 * - no máximo 4 motivos;
 * - "seguro" exige ao menos um motivo sustentado e nenhum impedimento (as mesmas regras de `aplicarGuardas`).
 */
export function verificarSintese(saida: SinteseModelo, extracao: Extracao, evidencias: Evidencia[]): ResultadoSintese {
  const fontes = fontesDeEvidencia(extracao, evidencias);
  let motivos: Motivo[] = saida.motivos
    .map((m) => ({ texto: m.texto.trim().slice(0, MAX_TEXTO_MOTIVO), evidencia: m.evidencia.trim() }))
    .filter((m) => m.texto !== "" && evidenciaSustentada(m.evidencia, fontes))
    .slice(0, MAX_MOTIVOS);

  let nivel = saida.nivel;
  let tipo = saida.tipo;
  if (nivel === "seguro" && (motivos.length === 0 || impedimentosDeSeguro(evidencias, extracao).length > 0)) {
    nivel = "suspeito";
    // Motivos escritos para justificar "seguro" não servem para "suspeito"; as guardas põem o motivo genérico.
    motivos = [];
    if (tipo === "nenhum") tipo = extracao.tipoProvavel === "nenhum" ? "outro" : extracao.tipoProvavel;
  }
  return { nivel, tipo, motivos };
}
