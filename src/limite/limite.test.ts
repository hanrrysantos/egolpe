import { describe, expect, it } from "vitest";
import {
  chavesLimite,
  LIMITE_BOT_DIA,
  LIMITE_POR_USUARIO_HORA,
  mensagemLimite,
  verificarLimite,
  type ArmazenamentoContador,
} from "./limite";

function redisFalso(): ArmazenamentoContador & { dados: Map<string, number> } {
  const dados = new Map<string, number>();
  return {
    dados,
    async incrementar(chave) {
      const n = (dados.get(chave) ?? 0) + 1;
      dados.set(chave, n);
      return n;
    },
  };
}

const agora = () => new Date("2026-11-24T15:20:00Z"); // 12:20 em Brasília

describe("chavesLimite", () => {
  it("usa o formato da modelagem, no horário de Brasília", () => {
    expect(chavesLimite(42, agora())).toEqual({ usuario: "limite:u:42:2026112412", bot: "limite:bot:20261124" });
  });
});

describe("verificarLimite", () => {
  it("abaixo do limite: permite", async () => {
    const r = await verificarLimite(1, { armazenamento: redisFalso(), agora });
    expect(r.permitido).toBe(true);
  });
  it("exatamente no limite: ainda permite; o próximo bloqueia", async () => {
    const armazenamento = redisFalso();
    for (let i = 0; i < LIMITE_POR_USUARIO_HORA; i++) {
      expect((await verificarLimite(1, { armazenamento, agora })).permitido).toBe(true);
    }
    const r = await verificarLimite(1, { armazenamento, agora });
    expect(r).toEqual({ permitido: false, motivo: "usuario", voltaEmMinutos: 40 });
    expect(mensagemLimite(r)).toContain("40 minutos");
  });
  it("outro usuário não é afetado", async () => {
    const armazenamento = redisFalso();
    for (let i = 0; i <= LIMITE_POR_USUARIO_HORA; i++) await verificarLimite(1, { armazenamento, agora });
    expect((await verificarLimite(2, { armazenamento, agora })).permitido).toBe(true);
  });
  it("estourado no bot inteiro", async () => {
    const armazenamento = redisFalso();
    armazenamento.dados.set(chavesLimite(5, agora()).bot, LIMITE_BOT_DIA);
    const r = await verificarLimite(5, { armazenamento, agora });
    expect(r.permitido).toBe(false);
    expect(r.motivo).toBe("bot");
    expect(r.voltaEmMinutos).toBe(11 * 60 + 40);
  });
  it("Redis falhando: fail-open e loga só o nome do erro", async () => {
    const erros: string[] = [];
    const armazenamento: ArmazenamentoContador = {
      async incrementar() {
        throw new TypeError("texto que não deve vazar");
      },
    };
    const r = await verificarLimite(1, { armazenamento, agora, aoFalhar: (e) => erros.push(e) });
    expect(r.permitido).toBe(true);
    expect(erros).toEqual(["TypeError"]);
  });
  it("sem Redis configurado: fail-open", async () => {
    const erros: string[] = [];
    const r = await verificarLimite(1, { armazenamento: null, aoFalhar: (e) => erros.push(e) });
    expect(r.permitido).toBe(true);
    expect(erros).toEqual(["redis_nao_configurado"]);
  });
});
