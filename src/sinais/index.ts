import type { ContextoSinais, Evidencia, Extracao, IdSinal, Marca, Sinal } from "@/src/nucleo/tipos";
import { criarResolvedorLinks, linksDaExtracao } from "./links";
import { MARCAS } from "./marcas";
import type { ResolvedorDns, Transporte } from "./rede";
import { criarSinalBoleto } from "./sinal-boleto";
import { criarSinalIdade } from "./sinal-idade";
import { criarSinalTelefone, normalizarTelefone } from "./sinal-telefone";
import { criarSinalDominioOficial, criarSinalLinkEncurtado, criarSinalSemelhanca } from "./sinais-dominio";
import { criarSinalOpenPhish, criarSinalSafeBrowsing, FEED_OPENPHISH } from "./sinais-listas";

export interface DepsSinais {
  marcas?: Marca[];
  feedOpenPhish?: string[];
  chaveSafeBrowsing?: () => string | undefined;
  /** DNS usado quando o contexto não traz `dns`. */
  dns?: ResolvedorDns;
  /** Transporte usado para seguir encurtadores (padrão: node:http(s) com IP fixado). Injetável nos testes. */
  transporte?: Transporte;
}

/** Monta a lista de sinais com dependências injetáveis (testes). */
export function criarSinais(deps: DepsSinais = {}): Sinal[] {
  const marcas = deps.marcas ?? MARCAS;
  const resolver = criarResolvedorLinks({ dns: deps.dns, transporte: deps.transporte });
  return [
    criarSinalLinkEncurtado(resolver),
    criarSinalDominioOficial(marcas, resolver),
    criarSinalSemelhanca(marcas, resolver),
    criarSinalIdade(marcas, resolver),
    criarSinalSafeBrowsing(resolver, deps.chaveSafeBrowsing),
    criarSinalOpenPhish(resolver, deps.feedOpenPhish ?? FEED_OPENPHISH),
    criarSinalTelefone(marcas),
    criarSinalBoleto(marcas),
  ];
}

/** Sinais ativos. A fase 1 (resolver links) é compartilhada entre eles. */
export const SINAIS: Sinal[] = criarSinais();

const SINAIS_DE_LINK: IdSinal[] = ["link_encurtado", "idade_dominio", "semelhanca_dominio", "dominio_oficial", "safe_browsing", "openphish"];

/** Evidência "sem resultado" para o que um sinal deixou de verificar (prazo ou erro). */
function semResultadoDe(id: IdSinal, extracao: Extracao): Evidencia[] {
  let alvos: [string, string][] = [];
  if (SINAIS_DE_LINK.includes(id)) {
    alvos = linksDaExtracao(extracao).map((u) => [u.href, "não deu tempo de verificar este link"]);
  } else if (id === "telefone_oficial") {
    alvos = extracao.telefones.map((t) => [normalizarTelefone(t.numero), "não deu tempo de verificar este telefone"]);
  } else if (id === "boleto_banco") {
    alvos = extracao.linhasDigitaveis.map((l) => [l, "não deu tempo de verificar este boleto"]);
  }
  return alvos.filter(([alvo]) => alvo !== "").map(([alvo, descricao]) => ({ sinal: id, resultado: "sem_resultado", alvo, descricao }));
}

/**
 * Etapa 2: roda todos os sinais em paralelo, dentro do prazo do contexto
 * (o menor entre `timeoutMs` e o `signal` do chamador).
 * Nunca lança. Sinal que estoura o prazo ou falha vira evidência `sem_resultado`
 * para cada alvo dele, em vez de sumir.
 */
export async function verificarSinais(extracao: Extracao, ctx: ContextoSinais, sinais: Sinal[] = SINAIS): Promise<Evidencia[]> {
  const prazo = AbortSignal.timeout(Math.max(0, ctx.timeoutMs));
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, prazo]) : prazo;
  const interno: ContextoSinais = { ...ctx, signal };
  const porSinal = new Map<number, Evidencia[]>();
  const esgotou = new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
  const todos = Promise.allSettled(
    sinais.map(async (s, i) => {
      try {
        porSinal.set(i, await s.verificar(extracao, interno));
      } catch {
        /* fica sem entrada: vira sem_resultado abaixo */
      }
    }),
  );
  await Promise.race([todos, esgotou]);
  return sinais.flatMap((s, i) => porSinal.get(i) ?? semResultadoDe(s.id, extracao));
}
