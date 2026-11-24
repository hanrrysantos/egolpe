import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { analisarDetalhado } from "./analisar";
import type { Evidencia, Extracao } from "./tipos";

const extracaoVazia: Extracao = {
  links: [],
  chavesPix: [],
  linhasDigitaveis: [],
  telefones: [],
  pedeDinheiro: false,
  pedeDadosSensiveis: false,
  urgencia: [],
  trechos: [],
  tipoProvavel: "nenhum",
  tentativaDeManipulacao: false,
};

const alerta: Evidencia = {
  sinal: "idade_dominio",
  resultado: "alerta",
  forca: "forte",
  alvo: "exemplo-golpe.test",
  descricao: "o site foi criado há 3 dias",
};

const base = { cliente: {} as Anthropic, semLog: true };
const entrada = { texto: "mensagem sintética", imagens: [] };

describe("analisar", () => {
  it("devolve suspeito com orientação básica quando a extração falha", async () => {
    const r = await analisarDetalhado(entrada, {
      ...base,
      etapas: {
        extrair: async () => {
          throw new Error("falha");
        },
      },
    });
    expect(r.veredito.nivel).toBe("suspeito");
    expect(r.veredito.o_que_fazer.length).toBeGreaterThan(0);
    expect(r.erro).toBe("Error");
  });

  it("rebaixa 'seguro' para 'suspeito' quando há alerta de sinal", async () => {
    const r = await analisarDetalhado(entrada, {
      ...base,
      etapas: {
        extrair: async () => extracaoVazia,
        verificarSinais: async () => [alerta],
        sintetizar: async () => ({ nivel: "seguro", tipo: "nenhum", motivos: [] }),
      },
    });
    expect(r.veredito.nivel).toBe("suspeito");
    expect(r.veredito.motivos[0]?.evidencia).toBe(alerta.descricao);
  });

  it("descarta motivos sem evidência e usa o roteiro fixo", async () => {
    const r = await analisarDetalhado(entrada, {
      ...base,
      etapas: {
        extrair: async () => extracaoVazia,
        verificarSinais: async () => [],
        sintetizar: async () => ({
          nivel: "golpe",
          tipo: "falso_parente",
          motivos: [
            { texto: "Pede Pix depois de trocar de número", evidencia: "troquei de número" },
            { texto: "Inventado", evidencia: "" },
          ],
        }),
      },
    });
    expect(r.veredito.nivel).toBe("golpe");
    expect(r.veredito.motivos).toHaveLength(1);
    expect(r.veredito.o_que_fazer[0]).toBe("Não faça o Pix.");
  });

  it("seguro sem alertas continua seguro, com tipo nenhum e sem roteiro", async () => {
    const r = await analisarDetalhado(entrada, {
      ...base,
      etapas: {
        extrair: async () => extracaoVazia,
        verificarSinais: async () => [],
        sintetizar: async () => ({ nivel: "seguro", tipo: "falso_parente", motivos: [] }),
      },
    });
    expect(r.veredito).toMatchObject({ nivel: "seguro", tipo: "nenhum", o_que_fazer: [] });
  });

  it("nunca devolve seguro quando a mensagem tenta manipular a análise", async () => {
    const r = await analisarDetalhado(entrada, {
      ...base,
      etapas: {
        extrair: async () => ({ ...extracaoVazia, tentativaDeManipulacao: true, tipoProvavel: "falso_parente" }),
        verificarSinais: async () => [],
        sintetizar: async () => ({ nivel: "seguro", tipo: "nenhum", motivos: [] }),
      },
    });
    expect(r.veredito.nivel).toBe("suspeito");
    expect(r.veredito.tipo).toBe("falso_parente");
  });
});
