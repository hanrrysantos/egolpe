import type { DepsModelo } from "@/src/extracao/extrair";
import { chamarModeloJson } from "@/src/extracao/modelo";
import type { ResultadoSintese } from "@/src/nucleo/guardas";
import type { Evidencia, Extracao } from "@/src/nucleo/tipos";
import { jsonSchemaSintese, montarConteudoSintese, schemaSinteseModelo, SISTEMA_SINTESE } from "./prompt";
import { verificarSintese } from "./verificar";

const MAX_TOKENS_SINTESE = 3072;

/**
 * Etapa 3: escolhe nível, tipo e motivos a partir da extração e das evidências.
 * Não escreve o_que_fazer (o núcleo copia do roteiro). Lança erro em falha.
 */
export async function sintetizar(
  extracao: Extracao,
  evidencias: Evidencia[],
  deps: DepsModelo,
): Promise<ResultadoSintese> {
  const saida = await chamarModeloJson({
    cliente: deps.cliente,
    modelo: deps.modelo,
    signal: deps.signal,
    system: SISTEMA_SINTESE,
    conteudo: montarConteudoSintese(extracao, evidencias),
    schemaJson: jsonSchemaSintese,
    schemaZod: schemaSinteseModelo,
    maxTokens: MAX_TOKENS_SINTESE,
  });
  return verificarSintese(saida, extracao, evidencias);
}
