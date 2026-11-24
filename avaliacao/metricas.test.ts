import { describe, expect, it } from "vitest";
import casos from "./casos.json";
import { calcularMetricas, formatarMarkdown, formatarTabela, percentil, validarCasos, type ResultadoCaso } from "./metricas";
import type { Nivel, TipoGolpe } from "../src/nucleo/tipos";

function r(
  id: string,
  esperado: Nivel,
  obtido: Nivel,
  extra: Partial<ResultadoCaso> & { tipoEsp?: TipoGolpe; tipoObt?: TipoGolpe } = {},
): ResultadoCaso {
  return {
    id,
    categoria: esperado === "seguro" ? "legitima" : "golpe",
    esperado: { nivel: esperado, tipo: extra.tipoEsp ?? (esperado === "seguro" ? "nenhum" : "falso_parente"), aceitaveis: extra.esperado?.aceitaveis },
    obtido: { nivel: obtido, tipo: extra.tipoObt ?? (obtido === "seguro" ? "nenhum" : "falso_parente") },
    motivos: [],
    evidencias: [],
    duracaoMs: extra.duracaoMs ?? 1000,
    erro: extra.erro,
  };
}

describe("percentil", () => {
  it("devolve 0 para lista vazia", () => expect(percentil([], 0.95)).toBe(0));
  it("calcula p95 por posição", () => {
    const v = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    expect(percentil(v, 0.95)).toBe(1900);
    expect(percentil([5], 0.95)).toBe(5);
  });
});

describe("calcularMetricas", () => {
  const resultados = [
    r("a", "golpe", "golpe"),
    r("b", "golpe", "suspeito", { esperado: { nivel: "golpe", tipo: "falso_parente", aceitaveis: ["suspeito"] } }),
    r("c", "golpe", "seguro"),
    r("d", "suspeito", "seguro"),
    r("e", "seguro", "seguro"),
    r("f", "seguro", "suspeito"),
    r("g", "golpe", "suspeito", { erro: "timeout", duracaoMs: 9000 }),
  ];
  const m = calcularMetricas(resultados);

  it("separa falhas técnicas dos percentuais", () => {
    expect(m.totalCasos).toBe(7);
    expect(m.falhasTecnicas).toBe(1);
    expect(m.avaliados).toBe(6);
  });
  it("acerto geral exato e aceitável", () => {
    expect(m.acertoGeral).toMatchObject({ acertos: 2, total: 6 });
    expect(m.acertoAceitavel).toMatchObject({ acertos: 3, total: 6 });
  });
  it("golpes como golpe e legítimas como seguras", () => {
    expect(m.golpesComoGolpe).toMatchObject({ acertos: 1, total: 3 });
    expect(m.legitimasComoSeguras).toMatchObject({ acertos: 1, total: 2 });
  });
  it("destaca falsos negativos, inclusive suspeito esperado", () => {
    expect(m.falsosNegativos).toEqual(["c", "d"]);
  });
  it("monta matriz de confusão", () => {
    expect(m.confusao.golpe).toEqual({ seguro: 1, suspeito: 1, golpe: 1 });
    expect(m.confusao.suspeito.seguro).toBe(1);
    expect(m.confusao.seguro).toEqual({ seguro: 1, suspeito: 1, golpe: 0 });
  });
  it("lista erros de nível exato sem as falhas técnicas", () => {
    expect(m.erros).toEqual(["b", "c", "d", "f"]);
  });
  it("tempo médio e p95 consideram todos os casos", () => {
    expect(m.duracaoMediaMs).toBeCloseTo((6 * 1000 + 9000) / 7);
    expect(m.duracaoP95Ms).toBe(9000);
  });
  it("acerto de tipo só entre golpes com nível aceitável", () => {
    const m2 = calcularMetricas([
      r("x", "golpe", "golpe", { tipoEsp: "taxa_entrega", tipoObt: "taxa_entrega" }),
      r("y", "golpe", "golpe", { tipoEsp: "taxa_entrega", tipoObt: "governo_falso" }),
      r("z", "golpe", "seguro", { tipoEsp: "taxa_entrega", tipoObt: "nenhum" }),
    ]);
    expect(m2.acertoTipoGolpes).toMatchObject({ acertos: 1, total: 2 });
  });
  it("conjunto vazio não gera NaN", () => {
    const vazio = calcularMetricas([]);
    expect(vazio.acertoGeral.taxa).toBe(0);
    expect(vazio.duracaoMediaMs).toBe(0);
  });
});

describe("formatação", () => {
  const m = calcularMetricas([r("c", "golpe", "seguro"), r("a", "golpe", "golpe")]);
  it("tabela destaca falsos negativos", () => {
    const t = formatarTabela("claude-haiku-5-5", m);
    expect(t).toContain("FALSOS NEGATIVOS");
    expect(t).toContain("c");
  });
  it("markdown compara modelos em colunas", () => {
    const md = formatarMarkdown([{ modelo: "claude-haiku-5-5", metricas: m }, { modelo: "claude-sonnet-5-5", metricas: m }], "2026-11-24");
    expect(md).toContain("| Métrica | claude-haiku-5-5 | claude-sonnet-5-5 |");
    expect(md).toContain("Falsos negativos");
  });
});

describe("validarCasos", () => {
  const base = { id: "x-01", categoria: "golpe", descricao: "d", entrada: { texto: "t" }, esperado: { nivel: "golpe", tipo: "falso_parente" } };
  it("aceita caso válido", () => expect(validarCasos([base])).toEqual([]));
  it("rejeita id duplicado e campos ausentes", () => {
    const p = validarCasos([base, base, { id: "y", categoria: "golpe" }]);
    expect(p.some((x) => x.includes("duplicado"))).toBe(true);
    expect(p.some((x) => x.includes("entrada"))).toBe(true);
    expect(p.some((x) => x.includes("esperado"))).toBe(true);
  });
  it("rejeita seguro com tipo diferente de nenhum", () => {
    expect(validarCasos([{ ...base, categoria: "legitima", esperado: { nivel: "seguro", tipo: "falso_parente" } }]).length).toBe(1);
  });
});

describe("casos.json", () => {
  it("é válido", () => expect(validarCasos(casos)).toEqual([]));
  it("tem ~100 casos, todos sintéticos (sem domínios reais de golpe)", () => {
    expect(casos.length).toBeGreaterThanOrEqual(100);
    const texto = JSON.stringify(casos);
    expect(texto).not.toMatch(/https?:\/\/(?!www\.gov\.br|rastreamento\.correios\.com\.br)[^"\s]*\.(com|com\.br|gov\.br)\b/);
  });
  it("cobre os 5 tipos com pelo menos 10 golpes cada", () => {
    for (const tipo of ["falso_parente", "falsa_central", "taxa_entrega", "boleto_adulterado", "governo_falso"]) {
      expect(casos.filter((c) => c.categoria === "golpe" && c.esperado.tipo === tipo).length).toBeGreaterThanOrEqual(10);
    }
  });
  it("injeções nunca aceitam seguro", () => {
    for (const c of casos.filter((c) => c.id.startsWith("inj-"))) {
      expect(c.esperado.nivel).toBe("golpe");
      expect((c.esperado as { aceitaveis?: string[] }).aceitaveis ?? []).not.toContain("seguro");
    }
  });
});
