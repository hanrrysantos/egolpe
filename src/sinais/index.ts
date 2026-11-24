import type { ContextoSinais, Evidencia, Extracao, Sinal } from "@/src/nucleo/tipos";
import type { Marca } from "@/src/nucleo/tipos";
import { MARCAS } from "./marcas";
import { dnsPadrao, type ResolvedorDns } from "./rede";
import { criarSinalBoleto } from "./sinal-boleto";
import { criarSinalIdade } from "./sinal-idade";
import { criarSinalTelefone } from "./sinal-telefone";
import { criarSinalDominioOficial, criarSinalLinkEncurtado, criarSinalSemelhanca } from "./sinais-dominio";
import { criarSinalOpenPhish, criarSinalSafeBrowsing, FEED_OPENPHISH } from "./sinais-listas";
import type { ContextoInterno } from "./links";

export interface DepsSinais {
  marcas?: Marca[];
  feedOpenPhish?: string[];
  chaveSafeBrowsing?: () => string | undefined;
  dns?: ResolvedorDns;
}

/** Monta a lista de sinais com dependências injetáveis (testes). */
export function criarSinais(deps: DepsSinais = {}): Sinal[] {
  const marcas = deps.marcas ?? MARCAS;
  return [
    criarSinalLinkEncurtado(),
    criarSinalDominioOficial(marcas),
    criarSinalSemelhanca(marcas),
    criarSinalIdade(marcas, deps.dns ?? dnsPadrao),
    criarSinalSafeBrowsing(deps.chaveSafeBrowsing),
    criarSinalOpenPhish(deps.feedOpenPhish ?? FEED_OPENPHISH),
    criarSinalTelefone(marcas),
    criarSinalBoleto(marcas),
  ];
}

/** Sinais ativos. A fase 1 (resolver links) é compartilhada entre eles (ver `resolverLinks`). */
export const SINAIS: Sinal[] = criarSinais();

/**
 * Etapa 2: roda todos os sinais em paralelo, dentro do prazo do contexto.
 * Nunca lança: falha de um sinal vira evidência "sem_resultado" ou é omitida.
 * Ao estourar o prazo, abortamos as chamadas de rede e devolvemos o que já terminou.
 */
export async function verificarSinais(extracao: Extracao, ctx: ContextoSinais, sinais: Sinal[] = SINAIS): Promise<Evidencia[]> {
  const controle = new AbortController();
  const interno: ContextoInterno = { ...ctx, signal: controle.signal };
  const coletadas: Evidencia[][] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      controle.abort();
      resolve();
    }, Math.max(0, ctx.timeoutMs));
  });
  const todos = Promise.allSettled(
    sinais.map(async (s) => {
      const evs = await s.verificar(extracao, interno);
      coletadas.push(evs);
    }),
  );
  try {
    await Promise.race([todos, prazo]);
  } finally {
    clearTimeout(timer);
  }
  return coletadas.flat();
}
