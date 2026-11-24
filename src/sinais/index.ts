import type { ContextoSinais, Evidencia, Extracao, Sinal } from "@/src/nucleo/tipos";

/** Sinais ativos. TODO(sinais): registrar os sinais implementados. */
export const SINAIS: Sinal[] = [];

/**
 * Etapa 2: roda todos os sinais em paralelo, dentro do prazo do contexto.
 * Nunca lança: falha de um sinal vira evidência "sem_resultado" ou é omitida.
 */
export async function verificarSinais(extracao: Extracao, ctx: ContextoSinais): Promise<Evidencia[]> {
  const resultados = await Promise.allSettled(SINAIS.map((s) => s.verificar(extracao, ctx)));
  return resultados.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
