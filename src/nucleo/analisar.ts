import Anthropic from "@anthropic-ai/sdk";
import { extrair, type DepsModelo } from "@/src/extracao/extrair";
import { sintetizar } from "@/src/sintese/sintetizar";
import { verificarSinais } from "@/src/sinais";
import { vereditoDeFalha } from "./fallback";
import { aplicarGuardas } from "./guardas";
import { descreverErro, registrarAnalise } from "./log";
import type {
  ContextoSinais,
  Entrada,
  Evidencia,
  Extracao,
  IdSinal,
  ModeloClaude,
  ResultadoSinal,
  Veredito,
} from "./tipos";

export const MODELO_PADRAO: ModeloClaude = "claude-haiku-5-5";

export interface OpcoesAnalise {
  modelo?: ModeloClaude;
  cliente?: Anthropic;
  /** Prazo total da análise, em ms. */
  timeoutMs?: number;
  /** Prazo dos sinais, em ms. */
  timeoutSinaisMs?: number;
  fetch?: typeof fetch;
  agora?: () => Date;
  /** Etapas substituíveis (testes e avaliação). */
  etapas?: Partial<Etapas>;
  /** Desliga o log de metadados (avaliação). */
  semLog?: boolean;
}

export interface Etapas {
  extrair: (entrada: Entrada, deps: DepsModelo) => Promise<Extracao>;
  verificarSinais: (extracao: Extracao, ctx: ContextoSinais) => Promise<Evidencia[]>;
  sintetizar: typeof sintetizar;
}

/** Resultado detalhado, usado pela avaliação. Os adaptadores usam só `veredito`. */
export interface AnaliseDetalhada {
  veredito: Veredito;
  extracao?: Extracao;
  evidencias: Evidencia[];
  duracaoMs: number;
  modelo: ModeloClaude;
  erro?: string;
}

function modeloDoAmbiente(): ModeloClaude {
  const m = process.env.MODELO_CLAUDE;
  return m === "claude-sonnet-5-5" || m === "claude-haiku-5-5" ? m : MODELO_PADRAO;
}

/** Núcleo de análise. Não conhece o canal. Nunca lança: em qualquer falha devolve 🟡 com orientação básica. */
export async function analisar(entrada: Entrada, opcoes: OpcoesAnalise = {}): Promise<Veredito> {
  return (await analisarDetalhado(entrada, opcoes)).veredito;
}

export async function analisarDetalhado(entrada: Entrada, opcoes: OpcoesAnalise = {}): Promise<AnaliseDetalhada> {
  const inicio = Date.now();
  const modelo = opcoes.modelo ?? modeloDoAmbiente();
  const etapas: Etapas = { extrair, verificarSinais, sintetizar, ...opcoes.etapas };
  const controle = new AbortController();
  const prazo = setTimeout(() => controle.abort(), opcoes.timeoutMs ?? 50_000);

  let extracao: Extracao | undefined;
  let evidencias: Evidencia[] = [];
  let veredito: Veredito;
  let erro: string | undefined;

  try {
    const cliente = opcoes.cliente ?? new Anthropic({ maxRetries: 1 });
    const deps: DepsModelo = { cliente, modelo, signal: controle.signal };
    extracao = await etapas.extrair(entrada, deps);
    evidencias = await etapas.verificarSinais(extracao, {
      fetch: opcoes.fetch ?? fetch,
      agora: opcoes.agora ?? (() => new Date()),
      timeoutMs: opcoes.timeoutSinaisMs ?? 8_000,
    });
    const sintese = await etapas.sintetizar(extracao, evidencias, deps);
    veredito = aplicarGuardas(sintese, evidencias);
  } catch (e) {
    erro = descreverErro(e);
    veredito = vereditoDeFalha();
  } finally {
    clearTimeout(prazo);
  }

  const duracaoMs = Date.now() - inicio;
  if (!opcoes.semLog) {
    const sinais: Partial<Record<IdSinal, ResultadoSinal>> = {};
    for (const ev of evidencias) if (sinais[ev.sinal] !== "alerta") sinais[ev.sinal] = ev.resultado;
    registrarAnalise({ duracaoMs, nivel: veredito.nivel, tipo: veredito.tipo, modelo, sinais, erro });
  }
  return { veredito, extracao, evidencias, duracaoMs, modelo, erro };
}
