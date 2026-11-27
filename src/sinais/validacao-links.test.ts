import { describe, expect, it } from "vitest";
import type { ContextoSinais, Evidencia, Extracao, Marca } from "@/src/nucleo/tipos";
import { criarSinais, verificarSinais } from "./index";
import { ehEncurtador, normalizarLink } from "./links";
import { analisarHost, MARCAS } from "./marcas";
import { FEED_OPENPHISH, hostCompartilhado } from "./sinais-listas";

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

const f404 = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
const ctxDe = (f: typeof fetch = f404): ContextoSinais => ({
  fetch: f,
  agora: () => new Date("2026-11-27T12:00:00Z"),
  timeoutMs: 5000,
  dns: DNS_PUBLICO,
});
const por = (evs: Evidencia[], id: Evidencia["sinal"]) => evs.filter((e) => e.sinal === id);

describe("base de links (dados/marcas.json e dados/openphish.json)", () => {
  it("todas as marcas não-bancárias estão conferidas, com fonte oficial e domínios válidos", () => {
    const naoBancos = MARCAS.filter((m) => m.categoria !== "banco");
    expect(naoBancos.length).toBeGreaterThanOrEqual(25);
    const ids = new Set<string>();

    for (const m of naoBancos) {
      expect(ids.has(m.id), `id duplicado: ${m.id}`).toBe(false);
      ids.add(m.id);
      expect(m.conferido, `${m.id} precisa estar conferido`).toBe(true);
      expect(m.fonte, `${m.id} precisa ter fonte oficial`).toMatch(/^https:\/\//);
      expect(m.dominios.length, `${m.id} precisa ter ao menos um domínio`).toBeGreaterThan(0);
      for (const d of m.dominios) {
        expect(d).toBe(d.toLowerCase());
        expect(d).not.toMatch(/^https?:\/\//);
        expect(d).not.toContain("/");
      }
    }

    // Correções específicas de categorização e domínios oficiais
    expect(MARCAS.find((m) => m.id === "serasa")?.categoria).toBe("outro");
    expect(analisarHost("www.azulcargoexpress.com.br", MARCAS)).toMatchObject({ tipo: "oficial", marca: { id: "azulcargo" } });
    expect(analisarHost("www.detran.sc.gov.br", MARCAS)).toMatchObject({ tipo: "oficial", marca: { id: "detran" } });
    expect(analisarHost("www.correios.com.br", MARCAS)).toMatchObject({ tipo: "oficial", marca: { id: "correios" } });
  });

  it("feed local do OpenPhish está populado com URLs http/https válidas e sem duplicatas", () => {
    expect(FEED_OPENPHISH.length).toBeGreaterThan(0);
    expect(new Set(FEED_OPENPHISH).size).toBe(FEED_OPENPHISH.length);
    for (const u of FEED_OPENPHISH) {
      expect(u).toMatch(/^https?:\/\//i);
    }
  });
});

describe("validações reforçadas de links", () => {
  const marcasBase: Marca[] = [
    {
      id: "caixa", nome: "Caixa Econômica Federal", nomePopular: "Caixa", categoria: "banco",
      dominios: ["caixa.gov.br"], palavrasChave: ["caixa"], telefones: [], codigoBanco: "104", conferido: true,
    },
    {
      id: "itau", nome: "Itaú", nomePopular: "Itaú", categoria: "banco",
      dominios: ["itau.com.br"], palavrasChave: ["itau"], telefones: [], codigoBanco: "341", conferido: false,
    },
    {
      id: "govbr", nome: "Portal gov.br", nomePopular: "gov.br", categoria: "governo",
      dominios: ["gov.br"], palavrasChave: ["govbr"], telefones: [], conferido: true,
    },
    {
      id: "inss", nome: "INSS", nomePopular: "INSS", categoria: "governo",
      dominios: ["inss.gov.br"], palavrasChave: ["inss"], telefones: [], conferido: true,
    },
    {
      id: "correios", nome: "Correios", nomePopular: "Correios", categoria: "entrega",
      dominios: ["correios.com.br"], palavrasChave: ["correios"], telefones: [], conferido: true,
    },
  ];

  const rodar = (e: Extracao, f: typeof fetch = f404) =>
    verificarSinais(e, ctxDe(f), criarSinais({ marcas: marcasBase, dns: DNS_PUBLICO, chaveSafeBrowsing: () => undefined, feedOpenPhish: [] }));

  it("normalizarLink remove caracteres invisíveis (zero-width) usados para burlar filtros", () => {
    expect(normalizarLink("https://ca\u200Bixa-golpe.test/entrar\uFEFF")?.href).toBe("https://caixa-golpe.test/entrar");
    expect(normalizarLink("bit.ly/\u00ADabc")?.href).toBe("http://bit.ly/abc");
  });

  it("reconhece encurtadores populares no Brasil", () => {
    for (const host of ["shre.ink", "abre.ai", "l1nq.com", "encr.pw", "curt.link", "dub.sh", "bitly.cx"]) {
      expect(ehEncurtador(host), host).toBe(true);
    }
  });

  it("detecta URL com truque de credenciais (@) como alerta forte", async () => {
    const ev = await rodar(extracao({ links: ["https://caixa.gov.br@golpe.test/entrar"] }));
    const e = por(ev, "dominio_oficial")[0]!;
    expect(e).toMatchObject({ resultado: "alerta", forca: "forte" });
    expect(e.descricao).toContain("golpe.test");
  });

  it("detecta link com endereço IP literal como alerta forte", async () => {
    const ev = await rodar(extracao({ links: ["http://185.220.101.1/login"] }));
    const e = por(ev, "dominio_oficial")[0]!;
    expect(e).toMatchObject({ resultado: "alerta", forca: "forte", alvo: "185.220.101.1" });
    expect(e.descricao).toContain("endereço IP");
  });

  it("alerta quando a mensagem alega uma marca mas o link é de outra marca incompatível", async () => {
    const ev = await rodar(
      extracao({
        links: ["https://www.correios.com.br/"],
        remetente: { descricao: "Caixa", marca: "Caixa", trocouDeNumero: false },
      }),
    );
    const e = por(ev, "dominio_oficial")[0]!;
    expect(e).toMatchObject({ resultado: "alerta", forca: "moderada", marca: "caixa" });
    expect(e.descricao).toContain("Correios");
  });

  it("aceita órgão público (INSS) apontando para o portal oficial gov.br sem falso alerta", async () => {
    const ev = await rodar(
      extracao({
        links: ["https://www.gov.br/inss/"],
        remetente: { descricao: "INSS", marca: "INSS", trocouDeNumero: false },
      }),
    );
    const e = por(ev, "dominio_oficial")[0]!;
    expect(e).toMatchObject({ resultado: "confirmacao", forca: "forte", marca: "govbr" });
  });

  it("domínio de marca NÃO conferida continua consultando RDAP (não pula idade_dominio)", async () => {
    const chamadas: string[] = [];
    const f = (async (input: string | URL | Request) => {
      chamadas.push(String(input instanceof Request ? input.url : input));
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const ev = await rodar(extracao({ links: ["https://itau.com.br/"] }), f);
    expect(chamadas.some((u) => u.includes("rdap.registro.br/domain/itau.com.br"))).toBe(true);
    expect(por(ev, "idade_dominio")).toHaveLength(1);
  });

  it("reconhece novos hosts de hospedagem compartilhada para evitar falso positivo no OpenPhish", () => {
    for (const h of ["linktr.ee", "meu-site.carrd.co", "teste.webflow.io", "app.supabase.co", "empresa.sharepoint.com"]) {
      expect(hostCompartilhado(h), h).toBe(true);
    }
    expect(hostCompartilhado("site-proprio-golpe.test")).toBe(false);
  });
});
