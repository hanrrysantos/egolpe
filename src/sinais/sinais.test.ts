import { describe, expect, it, beforeEach } from "vitest";
import type { ContextoSinais, Evidencia, Extracao, Marca } from "@/src/nucleo/tipos";
import { criarSinais, verificarSinais } from "./index";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ipBloqueado, seguirRedirecionamentos, transporteNode, validarDestino, type RespostaSalto, type Transporte } from "./rede";
import { limparCacheBootstrap } from "./sinal-idade";
import { dvModulo10, dvModulo11, validarLinhaDigitavel } from "./sinal-boleto";
import { normalizarTelefone } from "./sinal-telefone";
import { analisarHost, encontrarMarcaAlegada } from "./marcas";
import { ehEncurtador, normalizarLink } from "./links";

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

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
  {
    id: "itau", nome: "Itaú", nomePopular: "Itaú", categoria: "banco",
    dominios: ["itau.com.br"], palavrasChave: ["itau"], telefones: [], codigoBanco: "341", conferido: false,
  },
  {
    id: "correios", nome: "Correios", nomePopular: "Correios", categoria: "entrega",
    dominios: ["correios.com.br"], palavrasChave: ["correios"], telefones: [], conferido: true,
  },
];

function extracao(p: Partial<Extracao> = {}): Extracao {
  return {
    links: [], chavesPix: [], linhasDigitaveis: [], telefones: [], pedeDinheiro: false, pedeDadosSensiveis: false,
    urgencia: [], trechos: [], tipoProvavel: "nenhum", tentativaDeManipulacao: false, ...p,
  };
}

type Rota = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

function fetchFalso(rotas: Rota[], chamadas: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    chamadas.push(url);
    for (const r of rotas) {
      const res = await r(url, init);
      if (res) return res;
    }
    throw new TypeError("sem rota (rede bloqueada nos testes): " + url);
  }) as typeof fetch;
}

const redir = (para: string, status = 301) => new Response(null, { status, headers: { location: para } });
const ok = () => new Response("corpo", { status: 200 });

function ctxDe(f: typeof fetch, extra: Record<string, unknown> = {}): ContextoSinais {
  return { fetch: f, agora: () => new Date("2026-11-24T12:00:00Z"), timeoutMs: 5000, ...extra } as ContextoSinais;
}

const por = (evs: Evidencia[], id: Evidencia["sinal"]) => evs.filter((e) => e.sinal === id);

// ---------------------------------------------------------------------------
// SSRF e redirecionamentos
// ---------------------------------------------------------------------------

describe("ipBloqueado", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
    "::ffff:169.254.169.254", "64:ff9b::a00:1", "2001:db8::1",
  ])("bloqueia %s", (ip) => expect(ipBloqueado(ip)).toBe(true));

  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.63.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "permite %s",
    (ip) => expect(ipBloqueado(ip)).toBe(false),
  );
});

describe("validarDestino", () => {
  it("bloqueia hosts literais, locais, portas e esquemas", async () => {
    for (const u of ["http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest", "http://localhost/", "http://10.0.0.5/",
      "http://2130706433/", "http://0x7f.1/", "http://exemplo.test:8080/", "ftp://exemplo.test/", "http://user:pw@exemplo.test/"]) {
      expect((await validarDestino(new URL(u), DNS_PUBLICO)).ok, u).toBe(false);
    }
  });
  it("bloqueia host que resolve para IP privado (inclusive se só um IP for privado)", async () => {
    expect((await validarDestino(new URL("http://golpe.test/"), async () => ["10.0.0.1"])).ok).toBe(false);
    expect((await validarDestino(new URL("http://golpe.test/"), async () => ["93.184.216.34", "127.0.0.1"])).ok).toBe(false);
    expect((await validarDestino(new URL("http://golpe.test/"), async () => { throw new Error("x"); })).ok).toBe(false);
  });
  it("permite host público nas portas 80/443", async () => {
    expect((await validarDestino(new URL("https://golpe.test/"), DNS_PUBLICO)).ok).toBe(true);
    expect((await validarDestino(new URL("http://golpe.test:80/"), DNS_PUBLICO)).ok).toBe(true);
  });
});

/** Transporte falso: registra cada pedido (método e IP fixado) e responde pelas rotas. */
interface PedidoRegistrado { url: string; metodo: string; ip: string }
function transporteFalso(rotas: ((url: string, metodo: string) => RespostaSalto | undefined)[], pedidos: PedidoRegistrado[] = []): Transporte {
  return async ({ url, metodo, ip }) => {
    pedidos.push({ url: url.href, metodo, ip });
    for (const r of rotas) {
      const res = r(url.href, metodo);
      if (res) return res;
    }
    throw new TypeError("sem rota (rede bloqueada nos testes): " + url.href);
  };
}
const salto = (para: string, status = 301): RespostaSalto => ({ status, location: para });
const resp200: RespostaSalto = { status: 200 };
const tudo = () => true;

describe("seguirRedirecionamentos", () => {
  it("segue a cadeia de encurtadores com HEAD, fixando o IP validado", async () => {
    const pedidos: PedidoRegistrado[] = [];
    const t = transporteFalso([
      (u) => (u === "http://bit.ly/abc" ? salto("https://tinyurl.com/x") : undefined),
      (u) => (u === "https://tinyurl.com/x" ? salto("/final") : undefined),
      (u) => (u === "https://tinyurl.com/final" ? resp200 : undefined),
    ], pedidos);
    const r = await seguirRedirecionamentos(new URL("http://bit.ly/abc"), { transporte: t, dns: DNS_PUBLICO, consultar: tudo });
    expect(r).toMatchObject({ status: "ok", final: "https://tinyurl.com/final" });
    expect(r.cadeia).toHaveLength(3);
    expect(pedidos.every((p) => p.metodo === "HEAD" && p.ip === "93.184.216.34")).toBe(true);
  });

  it("cai para GET só quando o HEAD é recusado com 405 ou 501", async () => {
    for (const status of [405, 501]) {
      const pedidos: PedidoRegistrado[] = [];
      const t = transporteFalso([(u, m) => (m === "HEAD" ? { status } : u === "http://bit.ly/a" ? salto("https://golpe.test/") : undefined)], pedidos);
      const r = await seguirRedirecionamentos(new URL("http://bit.ly/a"), { transporte: t, dns: DNS_PUBLICO, consultar: (u) => u.hostname === "bit.ly" });
      expect(pedidos.map((p) => p.metodo)).toEqual(["HEAD", "GET"]);
      expect(r.final).toBe("https://golpe.test/");
    }
    const pedidos: PedidoRegistrado[] = [];
    const t = transporteFalso([() => ({ status: 404 })], pedidos);
    await seguirRedirecionamentos(new URL("http://bit.ly/a"), { transporte: t, dns: DNS_PUBLICO, consultar: tudo });
    expect(pedidos.map((p) => p.metodo)).toEqual(["HEAD"]);
  });

  it("não faz requisição ao destino que não é encurtador", async () => {
    const pedidos: PedidoRegistrado[] = [];
    const t = transporteFalso([(u) => (u === "http://bit.ly/a" ? salto("https://golpe-unico-da-vitima.test/?id=123") : undefined)], pedidos);
    const r = await seguirRedirecionamentos(new URL("http://bit.ly/a"), { transporte: t, dns: DNS_PUBLICO, consultar: (u) => ehEncurtador(u.hostname) });
    expect(r).toMatchObject({ status: "ok", final: "https://golpe-unico-da-vitima.test/?id=123" });
    expect(pedidos.map((p) => p.url)).toEqual(["http://bit.ly/a"]);
  });

  it("DNS rebinding: valida uma vez e a conexão recebe exatamente o IP validado", async () => {
    let consultas = 0;
    const dns = async () => (++consultas === 1 ? ["93.184.216.34"] : ["127.0.0.1"]);
    const pedidos: PedidoRegistrado[] = [];
    const t = transporteFalso([() => resp200], pedidos);
    const r = await seguirRedirecionamentos(new URL("http://bit.ly/a"), { transporte: t, dns, consultar: tudo });
    expect(r.status).toBe("ok");
    expect(consultas).toBe(1);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.ip).toBe("93.184.216.34");
  });

  it("para depois de 5 saltos", async () => {
    let n = 0;
    const t = transporteFalso([() => { n++; return salto(`http://salto${n}.test/`); }]);
    const r = await seguirRedirecionamentos(new URL("http://inicio.test/"), { transporte: t, dns: DNS_PUBLICO, consultar: tudo });
    expect(r.status).toBe("limite");
    expect(n).toBe(6); // inicial + 5 saltos seguidos; o sexto redirecionamento não é seguido
  });

  it.each(["http://127.0.0.1/admin", "http://10.0.0.1/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://golpe-interno.test/"])(
    "bloqueia redirecionamento para %s sem fazer a requisição",
    async (alvo) => {
      const pedidos: PedidoRegistrado[] = [];
      const t = transporteFalso([(u) => (u === "http://curto.test/a" ? salto(alvo) : undefined)], pedidos);
      const dns = async (h: string) => (h === "golpe-interno.test" ? ["192.168.1.10"] : ["93.184.216.34"]);
      const r = await seguirRedirecionamentos(new URL("http://curto.test/a"), { transporte: t, dns, consultar: tudo });
      expect(r.status).toBe("bloqueado");
      expect(pedidos.map((p) => p.url)).toEqual(["http://curto.test/a"]);
    },
  );

  it("falha de rede vira status falha", async () => {
    const r = await seguirRedirecionamentos(new URL("http://x.test/"), { transporte: transporteFalso([]), dns: DNS_PUBLICO, consultar: tudo });
    expect(r.status).toBe("falha");
  });
});

describe("transporteNode (conexão com IP fixado)", () => {
  it("conecta no IP validado sem resolver o nome do host e mantém o Host original", async () => {
    let hostRecebido = "";
    let metodoRecebido = "";
    const servidor = http.createServer((req, res) => {
      hostRecebido = String(req.headers.host);
      metodoRecebido = String(req.method);
      res.writeHead(302, { location: "https://destino.test/x" });
      res.end("corpo que nao deve ser lido");
    });
    await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
    try {
      const porta = (servidor.address() as AddressInfo).port;
      // "rebinding.invalid" não resolve em nenhum DNS: só conecta se o lookup devolver o IP fixado.
      const r = await transporteNode({ url: new URL(`http://rebinding.invalid:${porta}/p?q=1`), metodo: "HEAD", ip: "127.0.0.1" });
      expect(r).toEqual({ status: 302, location: "https://destino.test/x" });
      expect(hostRecebido).toBe(`rebinding.invalid:${porta}`);
      expect(metodoRecebido).toBe("HEAD");
    } finally {
      servidor.close();
    }
  });
});

describe("normalizarLink", () => {
  it("aceita sem esquema e rejeita outros esquemas", () => {
    expect(normalizarLink("bit.ly/abc")?.href).toBe("http://bit.ly/abc");
    expect(normalizarLink("https://a.test/x).")?.href).toBe("https://a.test/x");
    expect(normalizarLink("javascript:alert(1)")).toBeNull();
    expect(normalizarLink("ftp://a.test")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// link_encurtado
// ---------------------------------------------------------------------------

describe("link_encurtado", () => {
  const sinais = (transporte: Transporte, extra = {}) =>
    criarSinais({ marcas: marcasTeste, dns: DNS_PUBLICO, chaveSafeBrowsing: () => undefined, transporte, ...extra });
  const fetchRdap404 = fetchFalso([() => new Response("{}", { status: 404 })]);

  it("encurtador que leva a outro site gera alerta moderado, sem tocar o site de destino", async () => {
    const pedidos: PedidoRegistrado[] = [];
    const t = transporteFalso([(u) => (u === "http://bit.ly/x1" ? salto("https://caixa-beneficios.test/a") : undefined)], pedidos);
    const ev = await verificarSinais(extracao({ links: ["bit.ly/x1"] }), ctxDe(fetchRdap404), sinais(t));
    const e = por(ev, "link_encurtado")[0]!;
    expect(e).toMatchObject({ resultado: "alerta", forca: "moderada" });
    expect(e.descricao).toBe("o link curto leva, na verdade, para caixa-beneficios.test");
    expect(pedidos.map((p) => p.url)).toEqual(["http://bit.ly/x1"]);
  });

  it("encurtador bloqueado vira sem_resultado", async () => {
    const t = transporteFalso([(u) => (u === "http://bit.ly/x2" ? salto("http://169.254.169.254/") : undefined)]);
    const ev = await verificarSinais(extracao({ links: ["bit.ly/x2"] }), ctxDe(fetchRdap404), sinais(t));
    expect(por(ev, "link_encurtado")[0]?.resultado).toBe("sem_resultado");
  });

  it("link que não é de encurtador não recebe nenhuma requisição (nem fetch, nem transporte)", async () => {
    const pedidos: PedidoRegistrado[] = [];
    const t = transporteFalso([() => resp200], pedidos);
    const chamadas: string[] = [];
    const f = fetchFalso([() => new Response("{}", { status: 404 })], chamadas);
    const links = ["https://golpe-unico-da-vitima.test/a?id=9", "http://exemplo.test/", "https://www.caixa.gov.br/fgts"];
    const ev = await verificarSinais(extracao({ links }), ctxDe(f), sinais(t, { chaveSafeBrowsing: () => "k" }));
    expect(pedidos).toHaveLength(0);
    // só RDAP e Safe Browsing (hosts fixos) usam fetch; o site do link nunca é consultado
    for (const c of chamadas) expect(/^https:\/\/(rdap\.|data\.iana\.org|safebrowsing\.googleapis\.com)/.test(c), c).toBe(true);
    expect(por(ev, "link_encurtado")).toHaveLength(0);
    expect(por(ev, "safe_browsing")).toHaveLength(3);
  });

  it("ctx.dns tem precedência sobre o DNS injetado em criarSinais", async () => {
    const pedidos: PedidoRegistrado[] = [];
    const t = transporteFalso([() => resp200], pedidos);
    const dnsDoCtx = async () => ["93.184.216.7"];
    await verificarSinais(extracao({ links: ["bit.ly/z"] }), ctxDe(fetchRdap404, { dns: dnsDoCtx }), sinais(t, { dns: async () => ["10.0.0.1"] }));
    expect(pedidos[0]?.ip).toBe("93.184.216.7");
  });
});

// ---------------------------------------------------------------------------
// dominio_oficial / semelhanca_dominio
// ---------------------------------------------------------------------------

describe("marcas e semelhança", () => {
  it("casa a marca alegada ignorando acento e caixa", () => {
    expect(encontrarMarcaAlegada("ITAÚ Unibanco", marcasTeste)?.id).toBe("itau");
    expect(encontrarMarcaAlegada("Banco do Brasil", marcasTeste)?.id).toBe("bb");
    expect(encontrarMarcaAlegada("Padaria do João", marcasTeste)).toBeUndefined();
    expect(encontrarMarcaAlegada(undefined, marcasTeste)).toBeUndefined();
  });

  it("reconhece oficial e subdomínio oficial, mas não prefixo enganoso", () => {
    expect(analisarHost("www.caixa.gov.br", marcasTeste).tipo).toBe("oficial");
    expect(analisarHost("caixa.gov.br.seguro-login.test", marcasTeste).tipo).toBe("imitacao");
  });

  it.each(["caixa-beneficios.test", "cai-xa.test", "caixaa.test", "ca1xa.test", "bradesc0-seguro.test"])("detecta imitação %s", (h) => {
    const marcas = [...marcasTeste, { ...marcasTeste[0]!, id: "bradesco", nomePopular: "Bradesco", dominios: ["bradesco.com.br"], palavrasChave: ["bradesco"] }];
    expect(analisarHost(h, marcas).tipo).toBe("imitacao");
  });

  it("homóglifo rn -> m e dígito 1 -> l", () => {
    const m: Marca[] = [{ ...marcasTeste[0]!, id: "mm", nomePopular: "Mmarca", dominios: ["mmarca.com.br"], palavrasChave: ["mmarca"] }];
    expect(analisarHost("rnmarca.test", m).tipo).toBe("imitacao");
    const l: Marca[] = [{ ...marcasTeste[0]!, id: "ll", nomePopular: "Lloja", dominios: ["lloja.com.br"], palavrasChave: ["lloja"] }];
    expect(analisarHost("1loja.test", l).tipo).toBe("imitacao");
  });

  it("domínio sem relação não é imitação", () => {
    expect(analisarHost("padaria-da-esquina.test", marcasTeste).tipo).toBe("outro");
    expect(analisarHost("gov.br", marcasTeste).tipo).toBe("outro");
  });

  it("palavra curta só casa como palavra inteira", () => {
    expect(analisarHost("bb.test", marcasTeste).tipo).toBe("imitacao");
    expect(analisarHost("bbq-churrasco.test", marcasTeste).tipo).toBe("outro");
  });
});

describe("dominio_oficial e semelhanca_dominio (sinais)", () => {
  const f = fetchFalso([(u) => (/^https?:\/\/(www\.)?(caixa\.gov\.br|itau\.com\.br|caixa-beneficios\.test|padaria\.test)/.test(u) ? ok() : new Response("{}", { status: 404 }))]);
  const rodar = (links: string[], marca?: string) =>
    verificarSinais(
      extracao({ links, remetente: marca ? { descricao: marca, marca, trocouDeNumero: false } : undefined }),
      ctxDe(f, { dns: DNS_PUBLICO }),
      criarSinais({ marcas: marcasTeste, dns: DNS_PUBLICO, chaveSafeBrowsing: () => undefined }),
    );

  it("domínio oficial conferido gera confirmação forte", async () => {
    const e = por(await rodar(["https://www.caixa.gov.br/fgts"], "Caixa"), "dominio_oficial")[0]!;
    expect(e).toMatchObject({ resultado: "confirmacao", forca: "forte", marca: "caixa" });
  });

  it("domínio oficial de marca não conferida não confirma", async () => {
    const e = por(await rodar(["https://itau.com.br/"]), "dominio_oficial")[0]!;
    expect(e.resultado).toBe("sem_resultado");
  });

  it("imitação gera alerta forte com 'parece o site da Caixa, mas não é'", async () => {
    const ev = await rodar(["https://caixa-beneficios.test/"], "Caixa");
    const e = por(ev, "semelhanca_dominio")[0]!;
    expect(e).toMatchObject({ resultado: "alerta", forca: "forte", marca: "caixa" });
    expect(e.descricao).toContain("parece o site da Caixa, mas não é");
    expect(por(ev, "dominio_oficial")).toHaveLength(0);
  });

  it("marca alegada com link para domínio sem relação gera alerta moderado", async () => {
    const e = por(await rodar(["https://padaria.test/"], "Caixa"), "dominio_oficial")[0]!;
    expect(e).toMatchObject({ resultado: "alerta", forca: "moderada" });
  });

  it("sem marca alegada e domínio sem relação não gera nada", async () => {
    const ev = await rodar(["https://padaria.test/"]);
    expect(por(ev, "dominio_oficial")).toHaveLength(0);
    expect(por(ev, "semelhanca_dominio")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// idade_dominio (RDAP)
// ---------------------------------------------------------------------------

describe("idade_dominio", () => {
  beforeEach(() => limparCacheBootstrap());

  const rdap = (data: string) =>
    new Response(JSON.stringify({ events: [{ eventAction: "registration", eventDate: data }] }), { status: 200 });
  const rodar = (links: string[], rotas: Rota[]) =>
    verificarSinais(extracao({ links }), ctxDe(fetchFalso([...rotas, (u) => (u.startsWith("http") && !u.includes("rdap") && !u.includes("iana") ? ok() : undefined)]), { dns: DNS_PUBLICO }),
      criarSinais({ marcas: marcasTeste, dns: DNS_PUBLICO, chaveSafeBrowsing: () => undefined }));

  it(".br usa o RDAP do Registro.br; menos de 30 dias é alerta forte", async () => {
    const urls: string[] = [];
    const ev = await rodar(["https://loja-nova.com.br/"], [(u) => { urls.push(u); return u.startsWith("https://rdap.registro.br/domain/loja-nova.com.br") ? rdap("2026-11-20T00:00:00Z") : undefined; }]);
    const e = por(ev, "idade_dominio")[0]!;
    expect(e).toMatchObject({ resultado: "alerta", forca: "forte", alvo: "loja-nova.com.br" });
    expect(e.descricao).toBe("o site foi criado há 4 dias");
    expect(urls.some((u) => u.includes("whois"))).toBe(false);
  });

  it("entre 30 e 180 dias é alerta moderado", async () => {
    const ev = await rodar(["https://loja-media.com.br/"], [(u) => (u.startsWith("https://rdap.registro.br/") ? rdap("2026-08-01T00:00:00Z") : undefined)]);
    expect(por(ev, "idade_dominio")[0]).toMatchObject({ resultado: "alerta", forca: "moderada" });
  });

  it("domínio antigo é neutro", async () => {
    const ev = await rodar(["https://loja-antiga.com.br/"], [(u) => (u.startsWith("https://rdap.registro.br/") ? rdap("2015-01-01T00:00:00Z") : undefined)]);
    expect(por(ev, "idade_dominio")[0]?.resultado).toBe("neutro");
  });

  it("TLD fora do snapshot usa o bootstrap da IANA", async () => {
    const ev = await rodar(["https://golpe-novo.top/"], [
      (u) => (u === "https://data.iana.org/rdap/dns.json" ? new Response(JSON.stringify({ services: [[["top"], ["https://rdap.registro-top.test/"]]] })) : undefined),
      (u) => (u.startsWith("https://rdap.registro-top.test/domain/golpe-novo.top") ? rdap("2026-11-23T00:00:00Z") : undefined),
    ]);
    expect(por(ev, "idade_dominio")[0]).toMatchObject({ resultado: "alerta", forca: "forte" });
  });

  it("RDAP fora do ar ou sem data vira sem_resultado, nunca neutro", async () => {
    let ev = await rodar(["https://fora-do-ar.com.br/"], [(u) => (u.startsWith("https://rdap.registro.br/") ? new Response("erro", { status: 503 }) : undefined)]);
    expect(por(ev, "idade_dominio")[0]?.resultado).toBe("sem_resultado");
    ev = await rodar(["https://sem-data.com.br/"], [(u) => (u.startsWith("https://rdap.registro.br/") ? new Response(JSON.stringify({ events: [] })) : undefined)]);
    expect(por(ev, "idade_dominio")[0]?.resultado).toBe("sem_resultado");
    ev = await rodar(["https://rede-caiu.com.br/"], []);
    expect(por(ev, "idade_dominio")[0]?.resultado).toBe("sem_resultado");
  });

  it("domínio oficial da base não consulta RDAP", async () => {
    const chamadas: string[] = [];
    await verificarSinais(extracao({ links: ["https://www.caixa.gov.br/"] }), ctxDe(fetchFalso([() => ok()], chamadas), { dns: DNS_PUBLICO }),
      criarSinais({ marcas: marcasTeste, dns: DNS_PUBLICO, chaveSafeBrowsing: () => undefined }));
    expect(chamadas.some((u) => u.includes("rdap"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// safe_browsing e openphish
// ---------------------------------------------------------------------------

describe("safe_browsing", () => {
  const base = { marcas: marcasTeste, dns: DNS_PUBLICO };
  const link = extracao({ links: ["https://suspeito.test/pagina"] });

  it("sem chave: sem_resultado e nenhuma chamada ao Google", async () => {
    const chamadas: string[] = [];
    const ev = await verificarSinais(link, ctxDe(fetchFalso([() => ok()], chamadas), { dns: DNS_PUBLICO }), criarSinais({ ...base, chaveSafeBrowsing: () => undefined }));
    expect(por(ev, "safe_browsing")[0]?.resultado).toBe("sem_resultado");
    expect(chamadas.some((u) => u.includes("safebrowsing"))).toBe(false);
  });

  it("encontrado: alerta forte, e só as URLs vão no corpo", async () => {
    let corpo = "";
    const f = fetchFalso([
      (u, i) => {
        if (!u.startsWith("https://safebrowsing.googleapis.com/v4/threatMatches:find")) return undefined;
        corpo = String(i?.body);
        return new Response(JSON.stringify({ matches: [{ threatType: "SOCIAL_ENGINEERING", threat: { url: "https://suspeito.test/pagina" } }] }));
      },
      () => ok(),
    ]);
    const ev = await verificarSinais(link, ctxDe(f, { dns: DNS_PUBLICO }), criarSinais({ ...base, chaveSafeBrowsing: () => "chave-falsa" }));
    expect(por(ev, "safe_browsing")[0]).toMatchObject({ resultado: "alerta", forca: "forte" });
    expect(JSON.parse(corpo).threatInfo.threatEntries).toEqual([{ url: "https://suspeito.test/pagina" }]);
  });

  it("não encontrado: neutro (nunca confirmação)", async () => {
    const f = fetchFalso([(u) => (u.includes("safebrowsing") ? new Response("{}") : ok())]);
    const ev = await verificarSinais(link, ctxDe(f, { dns: DNS_PUBLICO }), criarSinais({ ...base, chaveSafeBrowsing: () => "k" }));
    expect(por(ev, "safe_browsing")[0]?.resultado).toBe("neutro");
  });

  it("serviço com erro: sem_resultado", async () => {
    const f = fetchFalso([(u) => (u.includes("safebrowsing") ? new Response("x", { status: 500 }) : ok())]);
    const ev = await verificarSinais(link, ctxDe(f, { dns: DNS_PUBLICO }), criarSinais({ ...base, chaveSafeBrowsing: () => "k" }));
    expect(por(ev, "safe_browsing")[0]?.resultado).toBe("sem_resultado");
  });
});

describe("openphish", () => {
  const feed = ["https://golpe-na-lista.test/entrar?x=1", "http://www.outro-golpe.test/login/"];
  const rodar = (links: string[]) =>
    verificarSinais(extracao({ links }), ctxDe(fetchFalso([() => ok()]), { dns: DNS_PUBLICO }),
      criarSinais({ marcas: marcasTeste, dns: DNS_PUBLICO, feedOpenPhish: feed, chaveSafeBrowsing: () => undefined }));

  it("URL exata na lista: alerta forte", async () => {
    expect(por(await rodar(["golpe-na-lista.test/entrar?x=1"]), "openphish")[0]).toMatchObject({ resultado: "alerta", forca: "forte" });
  });
  it("mesmo host, outro caminho: alerta forte", async () => {
    expect(por(await rodar(["https://outro-golpe.test/qualquer"]), "openphish")[0]?.resultado).toBe("alerta");
  });
  it("fora da lista: neutro", async () => {
    expect(por(await rodar(["https://limpo.test/"]), "openphish")[0]?.resultado).toBe("neutro");
  });
  it("feed vazio (padrão): neutro", async () => {
    const ev = await verificarSinais(extracao({ links: ["https://limpo.test/"] }), ctxDe(fetchFalso([() => ok()]), { dns: DNS_PUBLICO }),
      criarSinais({ marcas: marcasTeste, dns: DNS_PUBLICO, chaveSafeBrowsing: () => undefined }));
    expect(por(ev, "openphish")[0]?.resultado).toBe("neutro");
  });
});

// ---------------------------------------------------------------------------
// telefone_oficial
// ---------------------------------------------------------------------------

describe("telefone_oficial", () => {
  const rodar = (numero: string, marca?: string, contexto: "ligar_para" | "remetente" | "outro" = "ligar_para", marcas = marcasTeste) =>
    verificarSinais(
      extracao({ telefones: [{ numero, contexto }], remetente: marca ? { descricao: marca, marca, trocouDeNumero: false } : undefined }),
      ctxDe(fetchFalso([])),
      criarSinais({ marcas, dns: DNS_PUBLICO, chaveSafeBrowsing: () => undefined }),
    ).then((e) => por(e, "telefone_oficial"));

  it("normaliza +55, pontuação e 0800", () => {
    expect(normalizarTelefone("+55 (11) 4004-0001")).toBe("1140040001");
    expect(normalizarTelefone("0800 000 0104")).toBe("08000000104");
    expect(normalizarTelefone("0800-000-0104")).toBe("08000000104");
  });

  it("número oficial da marca conferida: confirmação", async () => {
    expect((await rodar("0800 000 0104", "Caixa"))[0]).toMatchObject({ resultado: "confirmacao", marca: "caixa" });
    expect((await rodar("(11) 4004-0001", "Banco do Brasil"))[0]?.resultado).toBe("confirmacao");
  });

  it("número diferente de banco conferido: alerta forte", async () => {
    const e = (await rodar("0800 123 4567", "Banco do Brasil"))[0]!;
    expect(e).toMatchObject({ resultado: "alerta", forca: "forte" });
    expect(e.descricao).toBe("esse número não é o da central oficial do Banco do Brasil");
  });

  it("marca sem telefones conferidos ou sem marca: sem_resultado", async () => {
    expect((await rodar("0800 123 4567", "Itaú"))[0]?.resultado).toBe("sem_resultado");
    expect((await rodar("0800 123 4567"))[0]?.resultado).toBe("sem_resultado");
  });

  it("telefone do remetente é ignorado; 'outro' só conta para banco", async () => {
    expect(await rodar("11 99999-0000", "Caixa", "remetente")).toHaveLength(0);
    expect(await rodar("11 99999-0000", "Correios", "outro")).toHaveLength(0);
    expect((await rodar("11 99999-0000", "Caixa", "outro"))[0]?.resultado).toBe("alerta");
  });
});

// ---------------------------------------------------------------------------
// boleto_banco
// ---------------------------------------------------------------------------

/** Gera linha digitável de 47 dígitos válida (sintética) para o banco dado. */
function linhaValida(banco: string, livre = "1234567890123456789012345", fatorValor = "99990000012345"): string {
  const semDv = banco + "9" + fatorValor + livre; // 3+1+14+25 = 43
  const dv = dvModulo11(semDv);
  const barras = banco + "9" + String(dv) + fatorValor + livre;
  const c1 = barras.slice(0, 4) + barras.slice(19, 24);
  const c2 = barras.slice(24, 34);
  const c3 = barras.slice(34, 44);
  return c1 + dvModulo10(c1) + c2 + dvModulo10(c2) + c3 + dvModulo10(c3) + String(dv) + fatorValor;
}

describe("boleto_banco", () => {
  const rodar = (linha: string, marca?: string) =>
    verificarSinais(
      extracao({ linhasDigitaveis: [linha], remetente: marca ? { descricao: marca, marca, trocouDeNumero: false } : undefined }),
      ctxDe(fetchFalso([])),
      criarSinais({ marcas: marcasTeste, dns: DNS_PUBLICO, chaveSafeBrowsing: () => undefined }),
    ).then((e) => por(e, "boleto_banco"));

  it("a linha sintética gerada é válida", () => {
    expect(validarLinhaDigitavel(linhaValida("104")).valido).toBe(true);
    expect(validarLinhaDigitavel(linhaValida("001")).valido).toBe(true);
  });

  it("DV correto e banco igual ao alegado: neutro (não 'seguro')", async () => {
    const e = (await rodar(linhaValida("104"), "Caixa"))[0]!;
    expect(e.resultado).toBe("neutro");
    expect(e.descricao).toContain("Caixa");
  });

  it("aceita pontuação na linha digitável", async () => {
    const l = linhaValida("104");
    const bonita = `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
    expect((await rodar(bonita, "Caixa"))[0]?.resultado).toBe("neutro");
  });

  it("DV de campo alterado: alerta forte", async () => {
    const l = linhaValida("104");
    const errada = l.slice(0, 9) + String((Number(l[9]) + 1) % 10) + l.slice(10);
    const e = (await rodar(errada, "Caixa"))[0]!;
    expect(e).toMatchObject({ resultado: "alerta", forca: "forte" });
    expect(e.descricao).toContain("os números do boleto não batem");
  });

  it("valor alterado (DV geral não bate): alerta forte", async () => {
    const l = linhaValida("104");
    const errada = l.slice(0, 46) + String((Number(l[46]) + 1) % 10);
    expect((await rodar(errada))[0]).toMatchObject({ resultado: "alerta", forca: "forte" });
  });

  it("banco diferente do alegado: alerta moderado com o nome do banco", async () => {
    const e = (await rodar(linhaValida("001"), "Caixa"))[0]!;
    expect(e).toMatchObject({ resultado: "alerta", forca: "moderada" });
    expect(e.descricao).toContain("Banco do Brasil");
  });

  it("48 dígitos (concessionária) e linhas curtas: sem_resultado", async () => {
    expect((await rodar("8" + "1".repeat(47)))[0]?.resultado).toBe("sem_resultado");
    expect((await rodar("12345"))[0]?.resultado).toBe("sem_resultado");
  });
});

// ---------------------------------------------------------------------------
// verificarSinais
// ---------------------------------------------------------------------------

describe("verificarSinais", () => {
  it("nunca lança e respeita o prazo total", async () => {
    const f = ((_u: string, init?: RequestInit) =>
      new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abortado"))))) as unknown as typeof fetch;
    const inicio = Date.now();
    const ev = await verificarSinais(
      extracao({ links: ["https://lento.test/"], linhasDigitaveis: [linhaValida("104")] }),
      { ...ctxDe(f, { dns: DNS_PUBLICO }), timeoutMs: 150 },
      criarSinais({ marcas: marcasTeste, dns: DNS_PUBLICO, chaveSafeBrowsing: () => undefined }),
    );
    expect(Date.now() - inicio).toBeLessThan(1500);
    expect(Array.isArray(ev)).toBe(true);
    expect(por(ev, "boleto_banco")).toHaveLength(1); // sinais locais terminam mesmo com a rede travada
  });

  it("sinal que lança não derruba os outros", async () => {
    const ev = await verificarSinais(extracao(), ctxDe(fetchFalso([])), [
      { id: "openphish", verificar: async () => { throw new Error("boom"); } },
      { id: "boleto_banco", verificar: async () => [{ sinal: "boleto_banco", resultado: "neutro", alvo: "x", descricao: "ok" }] },
    ]);
    expect(ev).toHaveLength(1);
  });

  it("extração vazia devolve lista vazia", async () => {
    expect(await verificarSinais(extracao(), ctxDe(fetchFalso([])))).toEqual([]);
  });
});
