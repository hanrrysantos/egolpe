import type Anthropic from "@anthropic-ai/sdk";
import type { Entrada, Extracao, ModeloClaude } from "@/src/nucleo/tipos";

export interface DepsModelo {
  cliente: Anthropic;
  modelo: ModeloClaude;
  /** Sinal para cancelar a chamada quando o prazo da análise acabar. */
  signal?: AbortSignal;
}

/**
 * Etapa 1: transforma o conteúdo bruto em dados estruturados.
 * Lança erro em falha da API, recusa ou saída inválida (o núcleo converte em veredito de falha).
 *
 * TODO(extracao-sintese): implementar.
 */
export async function extrair(_entrada: Entrada, _deps: DepsModelo): Promise<Extracao> {
  throw new Error("extrair: não implementado");
}
