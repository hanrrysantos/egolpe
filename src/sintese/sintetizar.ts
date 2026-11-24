import type { DepsModelo } from "@/src/extracao/extrair";
import type { ResultadoSintese } from "@/src/nucleo/guardas";
import type { Evidencia, Extracao } from "@/src/nucleo/tipos";

/**
 * Etapa 3: escolhe nível, tipo e motivos a partir da extração e das evidências.
 * Não escreve o_que_fazer (o núcleo copia do roteiro). Lança erro em falha.
 *
 * TODO(extracao-sintese): implementar.
 */
export async function sintetizar(
  _extracao: Extracao,
  _evidencias: Evidencia[],
  _deps: DepsModelo,
): Promise<ResultadoSintese> {
  throw new Error("sintetizar: não implementado");
}
