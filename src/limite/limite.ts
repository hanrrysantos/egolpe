import { Redis } from "@upstash/redis";
import { descreverErro } from "@/src/nucleo/log";

export const LIMITE_POR_USUARIO_HORA = 20;
export const LIMITE_BOT_DIA = 300;

/** Armazenamento de contadores. Só chave + número: nunca conteúdo. */
export interface ArmazenamentoContador {
  /** Soma 1 à chave, define a expiração e devolve o novo valor. */
  incrementar(chave: string, expiraEmSegundos: number): Promise<number>;
}

export type MotivoBloqueio = "usuario" | "bot";

export interface ResultadoLimite {
  permitido: boolean;
  motivo?: MotivoBloqueio;
  /** Minutos até o limite voltar (só quando bloqueado). */
  voltaEmMinutos?: number;
}

const FUSO_MS = -3 * 60 * 60 * 1000; // America/Sao_Paulo (sem horário de verão)

function p(n: number, t = 2): string {
  return String(n).padStart(t, "0");
}

/** Chaves conforme docs/modelagem.md. Usa o horário de Brasília para os baldes. */
export function chavesLimite(usuarioId: number, agora: Date): { usuario: string; bot: string } {
  const d = new Date(agora.getTime() + FUSO_MS);
  const dia = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  const hora = `${dia}${p(d.getUTCHours())}`;
  return { usuario: `limite:u:${usuarioId}:${hora}`, bot: `limite:bot:${dia}` };
}

function minutosAteFimDaHora(agora: Date): number {
  return 60 - agora.getUTCMinutes();
}

function minutosAteFimDoDia(agora: Date): number {
  const d = new Date(agora.getTime() + FUSO_MS);
  return (23 - d.getUTCHours()) * 60 + (60 - d.getUTCMinutes());
}

export interface DepsLimite {
  armazenamento: ArmazenamentoContador | null;
  agora?: () => Date;
  /** Chamado com o nome do erro (nunca conteúdo) quando o Redis falha. */
  aoFalhar?: (erro: string) => void;
}

/**
 * Conta uma análise e diz se pode seguir.
 *
 * Escolha de projeto: se o Redis estiver fora do ar ou sem configuração, FAIL-OPEN
 * (deixa analisar). Para um bot de proteção contra golpes, negar ajuda por causa de
 * uma falha de infraestrutura é pior do que perder temporariamente o controle de
 * abuso; o custo fica limitado pelo teto de gastos da chave da API. A falha é
 * logada só como metadado.
 */
export async function verificarLimite(usuarioId: number, deps: DepsLimite): Promise<ResultadoLimite> {
  const agora = (deps.agora ?? (() => new Date()))();
  if (!deps.armazenamento) {
    deps.aoFalhar?.("redis_nao_configurado");
    return { permitido: true };
  }
  const chaves = chavesLimite(usuarioId, agora);
  try {
    const doUsuario = await deps.armazenamento.incrementar(chaves.usuario, 60 * 60);
    if (doUsuario > LIMITE_POR_USUARIO_HORA) {
      return { permitido: false, motivo: "usuario", voltaEmMinutos: minutosAteFimDaHora(agora) };
    }
    const doBot = await deps.armazenamento.incrementar(chaves.bot, 24 * 60 * 60);
    if (doBot > LIMITE_BOT_DIA) {
      return { permitido: false, motivo: "bot", voltaEmMinutos: minutosAteFimDoDia(agora) };
    }
    return { permitido: true };
  } catch (e) {
    deps.aoFalhar?.(descreverErro(e));
    return { permitido: true };
  }
}

/** Armazenamento real no Upstash Redis. Devolve null se as variáveis não existirem. */
export function criarArmazenamentoUpstash(): ArmazenamentoContador | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  return {
    async incrementar(chave, expiraEmSegundos) {
      const [valor] = await redis.pipeline().incr(chave).expire(chave, expiraEmSegundos).exec<[number, number]>();
      return valor;
    },
  };
}

export function mensagemLimite(r: ResultadoLimite): string {
  const quando =
    r.voltaEmMinutos && r.voltaEmMinutos > 90
      ? `daqui a umas ${Math.ceil(r.voltaEmMinutos / 60)} horas`
      : `daqui a ${r.voltaEmMinutos ?? 60} minutos`;
  return r.motivo === "bot"
    ? `Hoje recebi muitas mensagens e não consigo analisar mais nenhuma. Tente de novo ${quando}.`
    : `Você já mandou muitas mensagens nesta hora. Posso analisar de novo ${quando}.`;
}
