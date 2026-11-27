import { describe, expect, it } from "vitest";
import type { ContextoSinais, Evidencia, Extracao } from "@/src/nucleo/tipos";
import { criarSinais, verificarSinais } from "./index";
import { analisarHost, BANCOS, buscarBancoPorCodigo, buscarBancoPorNome, MARCAS } from "./marcas";
import { dvModulo10, dvModulo11 } from "./sinal-boleto";

const DNS_PUBLICO = async () => ["93.184.216.34"];

function extracao(p: Partial<Extracao> = {}): Extracao {
  return {
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
    ...p,
  };
}

function linhaValida(banco: string, livre = "1234567890123456789012345", fatorValor = "99990000012345"): string {
  const semDv = banco + "9" + fatorValor + livre;
  const dv = dvModulo11(semDv);
  const barras = banco + "9" + String(dv) + fatorValor + livre;
  const c1 = barras.slice(0, 4) + barras.slice(19, 24);
  const c2 = barras.slice(24, 34);
  const c3 = barras.slice(34, 44);
  return c1 + dvModulo10(c1) + c2 + dvModulo10(c2) + c3 + dvModulo10(c3) + String(dv) + fatorValor;
}

const por = (evs: Evidencia[], id: Evidencia["sinal"]) => evs.filter((e) => e.sinal === id);

describe("base local de instituições bancárias (dados/bancos.json)", () => {
  it("todos os registros têm estrutura válida, telefones conferidos, código COMPE e fonte oficial", () => {
    expect(BANCOS.length).toBeGreaterThanOrEqual(30);
    const ids = new Set<string>();
    const codigos = new Set<string>();

    for (const b of BANCOS) {
      expect(ids.has(b.id), `id duplicado: ${b.id}`).toBe(false);
      ids.add(b.id);
      expect(b.categoria).toBe("banco");
      expect(b.conferido, `${b.id} precisa estar conferido`).toBe(true);
      expect(b.fonte, `${b.id} precisa ter fonte oficial`).toMatch(/^https:\/\//);
      expect(b.codigoBanco, `${b.id} precisa ter código COMPE de 3 dígitos`).toMatch(/^\d{3}$/);
      expect(codigos.has(b.codigoBanco!), `código COMPE duplicado: ${b.codigoBanco}`).toBe(false);
      codigos.add(b.codigoBanco!);
      expect(b.dominios.length, `${b.id} precisa ter ao menos um domínio`).toBeGreaterThan(0);
      for (const d of b.dominios) {
        expect(d).toBe(d.toLowerCase());
        expect(d).not.toMatch(/^https?:\/\//);
        expect(d).not.toContain("/");
      }
      expect(b.telefones.length, `${b.id} precisa ter telefones oficiais`).toBeGreaterThan(0);
      for (const t of b.telefones) {
        expect(t.numero, `telefone inválido em ${b.id}: ${t.numero}`).toMatch(/^\d{3,11}$/);
        expect(t.descricao.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("MARCAS integra BANCOS e demais marcas sem duplicar IDs", () => {
    const ids = MARCAS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of BANCOS) {
      expect(MARCAS.some((m) => m.id === b.id && m.conferido)).toBe(true);
    }
    expect(MARCAS.some((m) => m.id === "correios")).toBe(true);
  });

  it("busca local por código COMPE e por nome funciona sem rede", () => {
    expect(buscarBancoPorCodigo("104")?.id).toBe("caixa");
    expect(buscarBancoPorCodigo("77")?.id).toBe("inter");
    expect(buscarBancoPorCodigo("623")?.id).toBe("bancopan");
    expect(buscarBancoPorCodigo("121")?.id).toBe("agibank");
    expect(buscarBancoPorCodigo("999")).toBeUndefined();

    expect(buscarBancoPorNome("Nubank")?.id).toBe("nubank");
    expect(buscarBancoPorNome("Inter")?.id).toBe("inter");
    expect(buscarBancoPorNome("Banco Pan")?.id).toBe("bancopan");
    expect(buscarBancoPorNome("Efí Bank")?.id).toBe("efi");
  });

  it("reconhece domínios oficiais bancários sem falsos positivos em palavras comuns", () => {
    expect(analisarHost("inter.co", MARCAS)).toMatchObject({ tipo: "oficial", marca: { id: "inter" } });
    expect(analisarHost("www.nubank.com.br", MARCAS)).toMatchObject({ tipo: "oficial", marca: { id: "nubank" } });
    expect(analisarHost("agibank.com.br", MARCAS)).toMatchObject({ tipo: "oficial", marca: { id: "agibank" } });
    expect(analisarHost("sejaefi.com.br", MARCAS)).toMatchObject({ tipo: "oficial", marca: { id: "efi" } });

    // Palavras comuns parecidas com nomes curtos de bancos digitais não devem gerar falso positivo
    expect(analisarHost("internet-segura.com.br", MARCAS).tipo).toBe("outro");
    expect(analisarHost("decoracao-casa.com.br", MARCAS).tipo).toBe("outro");
    expect(analisarHost("produto-original.com.br", MARCAS).tipo).toBe("outro");
    expect(analisarHost("luzneon.com.br", MARCAS).tipo).toBe("outro");
    expect(analisarHost("gemstone.com", MARCAS).tipo).toBe("outro");

    // Imitações reais continuam sendo pegas
    expect(analisarHost("nubank-seguro.top", MARCAS)).toMatchObject({ tipo: "imitacao", marca: { id: "nubank" } });
    expect(analisarHost("agibank-consignado.test", MARCAS)).toMatchObject({ tipo: "imitacao", marca: { id: "agibank" } });
    expect(analisarHost("bancopan-cartao.test", MARCAS)).toMatchObject({ tipo: "imitacao", marca: { id: "bancopan" } });
  });

  it("valida telefones oficiais, falsas centrais, boletos e evita consulta RDAP para bancos da base", async () => {
    const chamadasRede: string[] = [];
    const fetchSpy = (async (input: string | URL | Request) => {
      chamadasRede.push(String(input instanceof Request ? input.url : input));
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const ctx: ContextoSinais = {
      fetch: fetchSpy,
      agora: () => new Date("2026-11-27T12:00:00Z"),
      timeoutMs: 5000,
      dns: DNS_PUBLICO,
    };
    const sinais = criarSinais({ dns: DNS_PUBLICO, chaveSafeBrowsing: () => undefined });

    // 1. Link oficial + telefone oficial do Nubank -> confirmação local e zero RDAP
    const evLegitimo = await verificarSinais(
      extracao({
        links: ["https://nubank.com.br/ajuda", "https://inter.co/"],
        telefones: [{ numero: "4020-0185", contexto: "ligar_para" }],
        remetente: { descricao: "Nubank", marca: "Nubank", trocouDeNumero: false },
      }),
      ctx,
      sinais,
    );
    expect(por(evLegitimo, "dominio_oficial")).toHaveLength(2);
    expect(por(evLegitimo, "dominio_oficial").every((e) => e.resultado === "confirmacao")).toBe(true);
    expect(por(evLegitimo, "telefone_oficial")[0]).toMatchObject({ resultado: "confirmacao", marca: "nubank" });
    expect(chamadasRede.some((u) => u.includes("rdap"))).toBe(false);

    // 2. Falsa central do Itaú -> alerta forte local
    const evFalsaCentral = await verificarSinais(
      extracao({
        telefones: [{ numero: "0800 555 9999", contexto: "ligar_para" }],
        remetente: { descricao: "Itaú", marca: "Itaú", trocouDeNumero: false },
      }),
      ctx,
      sinais,
    );
    expect(por(evFalsaCentral, "telefone_oficial")[0]).toMatchObject({
      resultado: "alerta",
      forca: "forte",
      marca: "itau",
    });

    // 3. Boleto emitido pelo Banco Pan (623) em mensagem que diz ser da Caixa -> alerta local com nome do banco
    const evBoleto = await verificarSinais(
      extracao({
        linhasDigitaveis: [linhaValida("623")],
        remetente: { descricao: "Caixa", marca: "Caixa", trocouDeNumero: false },
      }),
      ctx,
      sinais,
    );
    expect(por(evBoleto, "boleto_banco")[0]).toMatchObject({ resultado: "alerta", forca: "moderada", marca: "caixa" });
    expect(por(evBoleto, "boleto_banco")[0]?.descricao).toContain("Banco Pan");
  });
});
