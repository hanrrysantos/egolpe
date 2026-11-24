import { describe, expect, it } from "vitest";
import { impedimentosDeSeguro } from "@/src/nucleo/guardas";
import type { ContextoSinais, Evidencia, Extracao, Marca, Sinal } from "@/src/nucleo/tipos";
import { criarSinais, verificarSinais } from "./index";
import { limparCacheBootstrap } from "./sinal-idade";

const DNS_PUBLICO = async () => ["93.184.216.34"];

const marcasTeste: Marca[] = [
  {
    id: "caixa", nome: "Caixa Econômica Federal", nomePopular: "Caixa", categoria: "banco",
    dominios: ["caixa.gov.br"], palavrasChave: ["caixa", "cef"],
    telefones: [{ numero: "08000000104", descricao: "fictício" }], codigoBanco: "104", conferido: true,
  },
  {
    id: "bb", nome: "Banco do Brasil", nomePopular: "Banco do Brasil", categoria: "banco",
    dominios: ["bb.com.br"], palavrasChave: ["bancodobrasil", "bb"],
    telefones: [{ numero: "40040001", descricao: "fictício" }], codigoBanco: "001", conferido: true,
  },
];

function extracao(p: Partial<Extracao> = {}): Extracao {
  return {
    links: [], chavesPix: [], linhasDigitaveis: [], telefones: [], pedeDinheiro: false, pedeDadosSensiveis: false,
    urgencia: [], trechos: [], tipoProvavel: "nenhum", tentativaDeManipulacao: false, ...p,
  };
}

const f404 = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
const ctxDe = (f: typeof fetch, extra: Partial<ContextoSinais> = {}): ContextoSinais => ({
  fetch: f, agora: () => new Date("2026-11-24T12:00:00Z"), timeoutMs: 5000, ...extra,
});
const por = (evs: Evidencia[], id: Evidencia["sinal"]) => evs.filter((e) => e.sinal === id);
const travado = ((_u: string, init?: RequestInit) =>
  new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abortado"))))) as unknown as typeof fetch;

describe("prazo e cancelamento", () => {
  const lento: Sinal = { id: "openphish", verificar: () => new Promise<Evidencia[]>(() => {}) };

  it("sinal que estoura o prazo vira sem_resultado com alvo e descrição simples", async () => {
    const ev = await verificarSinais(extracao({ links: ["https://lento.test/a"] }), { ...ctxDe(travado), timeoutMs: 50 }, [lento]);
    expect(ev).toEqual([
      { sinal: "openphish", resultado: "sem_resultado", alvo: "https://lento.test/a", descricao: "não deu tempo de verificar este link" },
    ]);
  });

  it("o signal do chamador também encerra a verificação, e o signal chega aos sinais", async () => {
    const chamador = new AbortController();
    let recebido: AbortSignal | undefined;
    const espiao: Sinal = {
      id: "openphish",
      verificar: (_e, c) => {
        recebido = c.signal;
        return new Promise<Evidencia[]>(() => {});
      },
    };
    const p = verificarSinais(extracao({ links: ["https://lento.test/b"] }), { ...ctxDe(travado), timeoutMs: 60_000, signal: chamador.signal }, [espiao]);
    setTimeout(() => chamador.abort(), 20);
    const ev = await p;
    expect(ev[0]?.resultado).toBe("sem_resultado");
    expect(recebido?.aborted).toBe(true);
  });

  it("sinal que lança também vira sem_resultado para os seus alvos", async () => {
    const ev = await verificarSinais(extracao({ linhasDigitaveis: ["123"] }), ctxDe(f404), [
      { id: "boleto_banco", verificar: async () => { throw new Error("boom"); } },
    ]);
    expect(ev).toMatchObject([{ sinal: "boleto_banco", resultado: "sem_resultado", alvo: "123" }]);
  });

  it("RDAP que estoura o prazo vira sem_resultado de idade_dominio", async () => {
    limparCacheBootstrap();
    const ev = await verificarSinais(
      extracao({ links: ["https://loja-lenta.com.br/"] }),
      { ...ctxDe(travado), timeoutMs: 80 },
      criarSinais({ marcas: marcasTeste, dns: DNS_PUBLICO, chaveSafeBrowsing: () => undefined }),
    );
    expect(por(ev, "idade_dominio")[0]).toMatchObject({ resultado: "sem_resultado" });
  });
});

describe("openphish e hospedagem compartilhada", () => {
  const feed = [
    "https://docs.google.com/forms/d/e/golpe123/viewform",
    "https://conta-falsa.github.io/entrar",
    "https://meu-golpe.vercel.app/login",
    "https://golpe-proprio.test/a/b",
  ];
  const rodar = (link: string) =>
    verificarSinais(
      extracao({ links: [link] }),
      ctxDe(f404),
      criarSinais({ marcas: marcasTeste, dns: DNS_PUBLICO, feedOpenPhish: feed, chaveSafeBrowsing: () => undefined }),
    ).then((e) => por(e, "openphish")[0]!);

  it("URL completa igual em host compartilhado: alerta forte", async () => {
    expect(await rodar("https://docs.google.com/forms/d/e/golpe123/viewform")).toMatchObject({ resultado: "alerta", forca: "forte" });
    expect(await rodar("https://conta-falsa.github.io/entrar")).toMatchObject({ resultado: "alerta", forca: "forte" });
  });

  it.each([
    "https://docs.google.com/forms/d/e/formulario-legitimo/viewform",
    "https://sites.google.com/view/qualquer-coisa",
    "https://conta-falsa.github.io/outra-pagina",
    "https://meu-golpe.vercel.app/outro",
    "https://outra-conta.vercel.app/",
    "https://forms.gle/abc",
  ])("só o host em comum com a lista não gera alerta: %s", async (link) => {
    expect((await rodar(link)).resultado).toBe("neutro");
  });

  it("host próprio (não compartilhado) com outro caminho: no máximo alerta moderada", async () => {
    expect(await rodar("https://golpe-proprio.test/outro")).toMatchObject({ resultado: "alerta", forca: "moderada" });
    expect(await rodar("https://golpe-proprio.test/a/b")).toMatchObject({ resultado: "alerta", forca: "forte" });
  });
});

describe("alvo das confirmações bate com as guardas do núcleo", () => {
  const rodar = (e: Extracao) =>
    verificarSinais(e, ctxDe(f404), criarSinais({ marcas: marcasTeste, dns: DNS_PUBLICO, chaveSafeBrowsing: () => undefined }));

  it("dominio_oficial: o link oficial fica confirmado e o de imitação não", async () => {
    const remetente = { descricao: "Caixa", marca: "Caixa", trocouDeNumero: false };
    const e = extracao({ links: ["https://www.caixa.gov.br/fgts?x=1"], remetente });
    const ev = await rodar(e);
    expect(por(ev, "dominio_oficial")[0]?.alvo).toBe("caixa.gov.br");
    expect(impedimentosDeSeguro(ev, e)).not.toContain("link_nao_confirmado");

    const falso = extracao({ links: ["https://caixa-beneficios.test/"], remetente });
    expect(impedimentosDeSeguro(await rodar(falso), falso)).toContain("link_nao_confirmado");
  });

  it("telefone_oficial: o número com DDD ou +55 fica confirmado; o desconhecido não", async () => {
    const remetente = { descricao: "BB", marca: "Banco do Brasil", trocouDeNumero: false };
    const e = extracao({ telefones: [{ numero: "+55 (11) 4004-0001", contexto: "ligar_para" }], remetente });
    const ev = await rodar(e);
    expect(por(ev, "telefone_oficial")[0]).toMatchObject({ resultado: "confirmacao", alvo: "1140040001" });
    expect(impedimentosDeSeguro(ev, e)).not.toContain("telefone_nao_confirmado");

    const falso = extracao({ telefones: [{ numero: "0800 123 4567", contexto: "ligar_para" }], remetente });
    expect(impedimentosDeSeguro(await rodar(falso), falso)).toContain("telefone_nao_confirmado");
  });
});
