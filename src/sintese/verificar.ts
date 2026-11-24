import { normalizar } from "@/src/extracao/texto";
import type { ResultadoSintese } from "@/src/nucleo/guardas";
import type { Evidencia, Extracao, Motivo } from "@/src/nucleo/tipos";
import type { SinteseModelo } from "./prompt";

export const MAX_MOTIVOS = 4;
const MAX_TEXTO_MOTIVO = 300;
/** Evidência curta demais ("a", "pix") casaria com qualquer coisa. */
const MIN_EVIDENCIA = 4;

/** Tudo o que pode ser citado como evidência: dados da extração e descrições de alertas/confirmações. */
export function fontesDeEvidencia(extracao: Extracao, evidencias: Evidencia[]): string[] {
  return [
    ...extracao.trechos,
    ...extracao.urgencia,
    ...(extracao.valor ? [extracao.valor] : []),
    ...extracao.links,
    ...extracao.chavesPix.map((c) => c.valor),
    ...extracao.telefones.map((t) => t.numero),
    ...extracao.linhasDigitaveis,
    // "neutro" e "sem_resultado" não sustentam nada.
    ...evidencias.filter((e) => e.resultado === "alerta" || e.resultado === "confirmacao").map((e) => e.descricao),
  ]
    .map(normalizar)
    .filter((f) => f.length > 0);
}

/**
 * A evidência do motivo está nas fontes? Aceita citação parcial de uma fonte, ou a fonte
 * com um pouco de texto em volta (a fonte precisa ser a maior parte da evidência).
 */
export function evidenciaSustentada(evidencia: string, fontes: string[]): boolean {
  const ev = normalizar(evidencia.replace(/\\u003c/gi, "<").replace(/\\u003e/gi, ">"));
  if (ev.length < MIN_EVIDENCIA) return false;
  return fontes.some((f) => f.includes(ev) || (ev.includes(f) && f.length >= ev.length * 0.6));
}

/** Por que a mensagem não pode ser "seguro", mesmo que o modelo diga que é. */
function impedimentoDeSeguro(extracao: Extracao): boolean {
  return (
    extracao.tentativaDeManipulacao ||
    extracao.pedeDadosSensiveis ||
    (extracao.pedeDinheiro && extracao.remetente?.trocouDeNumero === true)
  );
}

/**
 * Verificação em código da saída do modelo (antes de `aplicarGuardas`, que o núcleo roda depois):
 * - descarta motivos cuja evidência não está na extração nem nas descrições de alerta/confirmação;
 * - no máximo 4 motivos;
 * - "seguro" é proibido quando há manipulação, pedido de dados sensíveis ou pedido de dinheiro com número novo.
 */
export function verificarSintese(saida: SinteseModelo, extracao: Extracao, evidencias: Evidencia[]): ResultadoSintese {
  const fontes = fontesDeEvidencia(extracao, evidencias);
  let motivos: Motivo[] = saida.motivos
    .map((m) => ({ texto: m.texto.trim().slice(0, MAX_TEXTO_MOTIVO), evidencia: m.evidencia.trim() }))
    .filter((m) => m.texto !== "" && evidenciaSustentada(m.evidencia, fontes))
    .slice(0, MAX_MOTIVOS);

  let nivel = saida.nivel;
  let tipo = saida.tipo;
  if (nivel === "seguro" && impedimentoDeSeguro(extracao)) {
    nivel = "suspeito";
    // Motivos escritos para justificar "seguro" não servem para "suspeito"; as guardas põem o motivo genérico.
    motivos = [];
    if (tipo === "nenhum") tipo = extracao.tipoProvavel === "nenhum" ? "outro" : extracao.tipoProvavel;
  }
  return { nivel, tipo, motivos };
}
