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
        sintetizar: async () => ({
          nivel: "seguro",
          tipo: "falso_parente",
          motivos: [{ texto: "É um lembrete de consulta, sem pedido de nada", evidencia: "sua consulta é amanhã" }],
        }),
      },
    });
    expect(r.veredito).toMatchObject({ nivel: "seguro", tipo: "nenhum", o_que_fazer: [] });
  });

  it("seguro sem nenhum motivo vira suspeito", async () => {
    const r = await analisarDetalhado(entrada, {
      ...base,
      etapas: {
        extrair: async () => extracaoVazia,
        verificarSinais: async () => [],
        sintetizar: async () => ({ nivel: "seguro", tipo: "nenhum", motivos: [] }),
      },
    });
    expect(r.veredito.nivel).toBe("suspeito");
  });

  it("descarta os motivos tranquilizadores ao rebaixar seguro por alerta", async () => {
    const r = await analisarDetalhado(entrada, {
      ...base,
      etapas: {
        extrair: async () => extracaoVazia,
        verificarSinais: async () => [alerta],
        sintetizar: async () => ({
          nivel: "seguro",
          tipo: "nenhum",
          motivos: [{ texto: "O link é do site oficial", evidencia: "criado há 3 dias" }],
        }),
      },
    });
    expect(r.veredito.nivel).toBe("suspeito");
    expect(r.veredito.motivos.map((m) => m.texto)).not.toContain("O link é do site oficial");
  });

  it("seguro com link sem confirmação de sinal vira suspeito", async () => {
    const link = "https://rastreio.exemplo.test/abc";
    const r = await analisarDetalhado(entrada, {
      ...base,
      etapas: {
        extrair: async () => ({ ...extracaoVazia, links: [link] }),
        verificarSinais: async () => [{ sinal: "safe_browsing", resultado: "neutro", alvo: link, descricao: "não está na lista" }],
        sintetizar: async () => ({ nivel: "seguro", tipo: "nenhum", motivos: [{ texto: "Rastreio", evidencia: "seu pedido" }] }),
      },
    });
    expect(r.veredito.nivel).toBe("suspeito");
  });

  it("seguro com link de domínio oficial confirmado continua seguro", async () => {
    const r = await analisarDetalhado(entrada, {
      ...base,
      etapas: {
        extrair: async () => ({ ...extracaoVazia, links: ["https://www.gov.br/inss"] }),
        verificarSinais: async () => [
          { sinal: "dominio_oficial", resultado: "confirmacao", forca: "forte", alvo: "gov.br", descricao: "o link é do site oficial do gov.br" },
        ],
        sintetizar: async () => ({
          nivel: "seguro",
          tipo: "nenhum",
          motivos: [{ texto: "O link é do site oficial", evidencia: "o link é do site oficial do gov.br" }],
        }),
      },
    });
    expect(r.veredito.nivel).toBe("seguro");
  });

  it("seguro com pedido de Pix vira suspeito", async () => {
    const r = await analisarDetalhado(entrada, {
      ...base,
      etapas: {
        extrair: async () => ({
          ...extracaoVazia,
          pedeDinheiro: true,
          chavesPix: [{ valor: "pix-ficticio@exemplo.test", tipo: "email" }],
        }),
        verificarSinais: async () => [],
        sintetizar: async () => ({ nivel: "seguro", tipo: "nenhum", motivos: [{ texto: "Parente", evidencia: "oi vó" }] }),
      },
    });
    expect(r.veredito.nivel).toBe("suspeito");
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
