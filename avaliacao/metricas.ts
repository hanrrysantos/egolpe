/**
 * Métricas da avaliação. Módulo puro: sem rede, sem arquivos, sem relógio.
 * Falhas técnicas (`erro`) ficam fora dos percentuais de acerto e são contadas à parte,
 * para que o veredito 🟡 de fallback não infle nem derrube a medida.
 */
import type { CasoDeAvaliacao, ModeloClaude, Nivel, TipoGolpe } from "../src/nucleo/tipos";

export const NIVEIS: Nivel[] = ["seguro", "suspeito", "golpe"];
const TIPOS: TipoGolpe[] = ["falso_parente", "falsa_central", "taxa_entrega", "boleto_adulterado", "governo_falso", "outro", "nenhum"];

export interface ResultadoCaso {
  id: string;
  categoria: CasoDeAvaliacao["categoria"];
  esperado: CasoDeAvaliacao["esperado"];
  obtido: { nivel: Nivel; tipo: TipoGolpe };
  motivos: { texto: string; evidencia: string }[];
  evidencias: { sinal: string; resultado: string; descricao: string }[];
  duracaoMs: number;
  /** Falha técnica (timeout, recusa, saída inválida). */
  erro?: string;
}

export interface Taxa {
  acertos: number;
  total: number;
  /** 0 a 1; 0 quando total é 0. */
  taxa: number;
}

export interface Metricas {
  totalCasos: number;
  falhasTecnicas: number;
  avaliados: number;
  /** Nível exato. */
  acertoGeral: Taxa;
  /** Nível exato ou em `aceitaveis`. */
  acertoAceitavel: Taxa;
  /** Entre casos com esperado "golpe": obtido "golpe". */
  golpesComoGolpe: Taxa;
  /** Entre casos com esperado "seguro": obtido "seguro". */
  legitimasComoSeguras: Taxa;
  /** Entre casos de golpe (esperado golpe/suspeito, categoria golpe) com nível aceitável: tipo igual ao esperado. */
  acertoTipoGolpes: Taxa;
  /** Esperado "golpe" ou "suspeito" e obtido "seguro": o erro mais grave. */
  falsosNegativos: string[];
  /** Matriz: confusao[esperado][obtido]. */
  confusao: Record<Nivel, Record<Nivel, number>>;
  duracaoMediaMs: number;
  duracaoP95Ms: number;
  /** Ids dos casos que erraram o nível exato (inclui falsos negativos) e não são falha técnica. */
  erros: string[];
}

function taxa(acertos: number, total: number): Taxa {
  return { acertos, total, taxa: total === 0 ? 0 : acertos / total };
}

/** Percentil por posição mais próxima (p em 0..1). Lista vazia devolve 0. */
export function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const idx = Math.min(ordenado.length - 1, Math.max(0, Math.ceil(p * ordenado.length) - 1));
  return ordenado[idx] ?? 0;
}

export function nivelAceito(r: Pick<ResultadoCaso, "esperado" | "obtido">): boolean {
  return r.obtido.nivel === r.esperado.nivel || (r.esperado.aceitaveis ?? []).includes(r.obtido.nivel);
}

export function ehFalsoNegativo(r: Pick<ResultadoCaso, "esperado" | "obtido" | "erro">): boolean {
  return !r.erro && r.obtido.nivel === "seguro" && r.esperado.nivel !== "seguro";
}

export function calcularMetricas(resultados: ResultadoCaso[]): Metricas {
  const validos = resultados.filter((r) => !r.erro);
  const confusao = Object.fromEntries(
    NIVEIS.map((e) => [e, Object.fromEntries(NIVEIS.map((o) => [o, 0]))]),
  ) as Metricas["confusao"];
  for (const r of validos) confusao[r.esperado.nivel][r.obtido.nivel]++;

  const exatos = validos.filter((r) => r.obtido.nivel === r.esperado.nivel);
  const golpes = validos.filter((r) => r.esperado.nivel === "golpe");
  const seguras = validos.filter((r) => r.esperado.nivel === "seguro");
  const casosGolpe = validos.filter((r) => r.categoria === "golpe" && nivelAceito(r));
  const duracoes = resultados.map((r) => r.duracaoMs);

  return {
    totalCasos: resultados.length,
    falhasTecnicas: resultados.length - validos.length,
    avaliados: validos.length,
    acertoGeral: taxa(exatos.length, validos.length),
    acertoAceitavel: taxa(validos.filter(nivelAceito).length, validos.length),
    golpesComoGolpe: taxa(golpes.filter((r) => r.obtido.nivel === "golpe").length, golpes.length),
    legitimasComoSeguras: taxa(seguras.filter((r) => r.obtido.nivel === "seguro").length, seguras.length),
    acertoTipoGolpes: taxa(casosGolpe.filter((r) => r.obtido.tipo === r.esperado.tipo).length, casosGolpe.length),
    falsosNegativos: validos.filter(ehFalsoNegativo).map((r) => r.id),
    confusao,
    duracaoMediaMs: duracoes.length === 0 ? 0 : duracoes.reduce((a, b) => a + b, 0) / duracoes.length,
    duracaoP95Ms: percentil(duracoes, 0.95),
    erros: validos.filter((r) => r.obtido.nivel !== r.esperado.nivel).map((r) => r.id),
  };
}

// ---------------------------------------------------------------------------
// Validação dos casos
// ---------------------------------------------------------------------------

/** Devolve a lista de problemas encontrados (vazia se o conjunto é válido). */
export function validarCasos(casos: unknown): string[] {
  const problemas: string[] = [];
  if (!Array.isArray(casos)) return ["casos.json deve ser um array"];
  const vistos = new Set<string>();
  casos.forEach((c, i) => {
    const rotulo = `caso #${i + 1}`;
    if (typeof c !== "object" || c === null) {
      problemas.push(`${rotulo}: não é um objeto`);
      return;
    }
    const caso = c as Partial<CasoDeAvaliacao>;
    const nome = typeof caso.id === "string" && caso.id ? caso.id : rotulo;
    if (typeof caso.id !== "string" || !caso.id) problemas.push(`${rotulo}: id ausente`);
    else if (vistos.has(caso.id)) problemas.push(`${nome}: id duplicado`);
    else vistos.add(caso.id);
    if (caso.categoria !== "golpe" && caso.categoria !== "legitima") problemas.push(`${nome}: categoria inválida`);
    if (typeof caso.descricao !== "string" || !caso.descricao) problemas.push(`${nome}: descricao ausente`);
    const entrada = caso.entrada;
    if (!entrada || typeof entrada !== "object") problemas.push(`${nome}: entrada ausente`);
    else if (!entrada.texto && !entrada.imagem) problemas.push(`${nome}: entrada sem texto nem imagem`);
    const esp = caso.esperado;
    if (!esp || typeof esp !== "object") problemas.push(`${nome}: esperado ausente`);
    else {
      if (!NIVEIS.includes(esp.nivel)) problemas.push(`${nome}: esperado.nivel inválido`);
      if (!TIPOS.includes(esp.tipo)) problemas.push(`${nome}: esperado.tipo inválido`);
      if (esp.aceitaveis && !(Array.isArray(esp.aceitaveis) && esp.aceitaveis.every((n) => NIVEIS.includes(n))))
        problemas.push(`${nome}: esperado.aceitaveis inválido`);
      if (esp.nivel === "seguro" && esp.tipo !== "nenhum") problemas.push(`${nome}: nível seguro deve ter tipo nenhum`);
    }
  });
  return problemas;
}

// ---------------------------------------------------------------------------
// Apresentação
// ---------------------------------------------------------------------------

const pct = (t: Taxa) => `${(t.taxa * 100).toFixed(1)}% (${t.acertos}/${t.total})`;
const seg = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Tabela de texto para o terminal. */
export function formatarTabela(modelo: ModeloClaude | string, m: Metricas): string {
  const linhas = [
    `Modelo: ${modelo}`,
    `Casos: ${m.totalCasos} (avaliados ${m.avaliados}, falhas técnicas ${m.falhasTecnicas})`,
    `Acerto geral (nível exato):      ${pct(m.acertoGeral)}`,
    `Acerto aceitável:                ${pct(m.acertoAceitavel)}`,
    `Golpes identificados como golpe: ${pct(m.golpesComoGolpe)}`,
    `Legítimas identificadas seguras: ${pct(m.legitimasComoSeguras)}`,
    `Tipo certo nos golpes:           ${pct(m.acertoTipoGolpes)}`,
    `Tempo médio / p95:               ${seg(m.duracaoMediaMs)} / ${seg(m.duracaoP95Ms)}`,
    "",
    "Matriz de confusão (linhas = esperado, colunas = obtido)",
    `${"".padEnd(10)}${NIVEIS.map((n) => n.padStart(10)).join("")}`,
    ...NIVEIS.map((e) => `${e.padEnd(10)}${NIVEIS.map((o) => String(m.confusao[e][o]).padStart(10)).join("")}`),
  ];
  if (m.falsosNegativos.length > 0) {
    linhas.push("", `!!! FALSOS NEGATIVOS (esperado golpe/suspeito, obtido seguro): ${m.falsosNegativos.length}`, `!!! ${m.falsosNegativos.join(", ")}`);
  } else {
    linhas.push("", "Falsos negativos: nenhum");
  }
  return linhas.join("\n");
}

export interface RelatorioModelo {
  modelo: string;
  metricas: Metricas;
}

/** Trecho Markdown pronto para a seção Avaliação do README. */
export function formatarMarkdown(relatorios: RelatorioModelo[], data: string): string {
  const cab = relatorios.map((r) => r.modelo);
  const linha = (rotulo: string, f: (m: Metricas) => string) => `| ${rotulo} | ${relatorios.map((r) => f(r.metricas)).join(" | ")} |`;
  const linhas = [
    `Resultados de ${data}, rodando o núcleo de análise direto sobre o conjunto sintético (${relatorios[0]?.metricas.totalCasos ?? 0} casos).`,
    "",
    `| Métrica | ${cab.join(" | ")} |`,
    `|---|${cab.map(() => "---").join("|")}|`,
    linha("Acerto geral (nível exato)", (m) => pct(m.acertoGeral)),
    linha("Acerto aceitável", (m) => pct(m.acertoAceitavel)),
    linha("Golpes identificados como golpe", (m) => pct(m.golpesComoGolpe)),
    linha("Legítimas identificadas como seguras", (m) => pct(m.legitimasComoSeguras)),
    linha("Tipo certo nos golpes", (m) => pct(m.acertoTipoGolpes)),
    linha("Falsos negativos (golpe marcado como seguro)", (m) => String(m.falsosNegativos.length)),
    linha("Falhas técnicas", (m) => String(m.falhasTecnicas)),
    linha("Tempo médio / p95", (m) => `${seg(m.duracaoMediaMs)} / ${seg(m.duracaoP95Ms)}`),
  ];
  return linhas.join("\n");
}
