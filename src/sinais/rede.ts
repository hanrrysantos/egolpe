import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

/** Resolve um nome para os IPs que ele aponta. Injetável para testes. */
export type ResolvedorDns = (host: string) => Promise<string[]>;

export const dnsPadrao: ResolvedorDns = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

export interface RespostaSalto {
  status: number;
  location?: string;
}

export interface PedidoSalto {
  url: URL;
  metodo: "HEAD" | "GET";
  /** IP já validado contra SSRF: a conexão TEM de ir para ele, sem nova resolução de DNS. */
  ip: string;
  signal?: AbortSignal;
}

/** Faz uma requisição sem seguir redirecionamento nem ler o corpo. Injetável para testes. */
export type Transporte = (pedido: PedidoSalto) => Promise<RespostaSalto>;

/** Transporte padrão: node:http(s) com `lookup` que só devolve o IP validado (evita DNS rebinding). */
export const transporteNode: Transporte = ({ url, metodo, ip, signal }) =>
  new Promise<RespostaSalto>((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const seguro = url.protocol === "https:";
    const familia = isIP(ip) === 6 ? 6 : 4;
    const req = (seguro ? https : http).request(
      {
        hostname: host,
        port: url.port || (seguro ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: metodo,
        agent: false,
        signal,
        headers: { accept: "*/*", "user-agent": "verificador-de-links/1.0", connection: "close" },
        ...(seguro && !isIP(host) ? { servername: host } : {}),
        lookup: ((_nome: string, opcoes: { all?: boolean }, cb: (...a: unknown[]) => void) => {
          if (opcoes?.all) cb(null, [{ address: ip, family: familia }]);
          else cb(null, ip, familia);
        }) as never,
      },
      (res) => {
        const loc = res.headers.location;
        resolve({ status: res.statusCode ?? 0, location: Array.isArray(loc) ? loc[0] : loc });
        res.destroy(); // não baixa o corpo
      },
    );
    req.on("error", reject);
    req.end();
  });

// ---------------------------------------------------------------------------
// IPs bloqueados (SSRF)
// ---------------------------------------------------------------------------

function ipv4ParaNumeros(ip: string): number[] | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  const n = p.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  return n.some((x) => !(x >= 0 && x <= 255)) ? null : n;
}

function ipv4Bloqueado(n: number[]): boolean {
  const [a, b, c] = n as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local e metadados
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast e reservados
  );
}

function expandirIpv6(ipEntrada: string): number[] | null {
  let ip = ipEntrada.split("%")[0] ?? "";
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (v4) {
    const n = ipv4ParaNumeros(v4[1]!);
    if (!n) return null;
    const hex = ((n[0]! << 8) | n[1]!).toString(16) + ":" + ((n[2]! << 8) | n[3]!).toString(16);
    ip = ip.slice(0, ip.length - v4[1]!.length) + hex;
  }
  const partes = ip.split("::");
  if (partes.length > 2) return null;
  const ler = (s: string) => (s === "" ? [] : s.split(":"));
  const esq = ler(partes[0]!);
  const dir = partes.length === 2 ? ler(partes[1]!) : [];
  const falta = 8 - esq.length - dir.length;
  if (partes.length === 1 ? esq.length !== 8 : falta < 1) return null;
  const todos = [...esq, ...Array<string>(partes.length === 2 ? falta : 0).fill("0"), ...dir];
  const nums = todos.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return nums.length === 8 && nums.every((x) => !Number.isNaN(x)) ? nums : null;
}

/** true se o IP é privado, local, de metadados, CGNAT, reservado ou não pôde ser interpretado. */
export function ipBloqueado(ip: string): boolean {
  const limpo = ip.replace(/^\[|\]$/g, "");
  const tipo = isIP(limpo);
  if (tipo === 4) {
    const n = ipv4ParaNumeros(limpo);
    return !n || ipv4Bloqueado(n);
  }
  if (tipo === 6) {
    const g = expandirIpv6(limpo);
    if (!g) return true;
    const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
    const v4 = [g6 >> 8, g6 & 255, g7 >> 8, g7 & 255];
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
      // ::, ::1, ::a.b.c.d (obsoleto) bloqueados; ::ffff:a.b.c.d vale o IPv4 embutido
      return g5 === 0xffff ? ipv4Bloqueado(v4) : true;
    }
    if (g0 === 0x64 && g1 === 0xff9b) return ipv4Bloqueado(v4); // NAT64
    if (g0 === 0x2002) return ipv4Bloqueado([g1 >> 8, g1 & 255, g2 >> 8, g2 & 255]); // 6to4
    if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return true; // teredo, documentação
    if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
    return (g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0 || g0 >> 8 === 0xff;
  }
  return true;
}

export type ValidacaoDestino = { ok: true; ips: string[] } | { ok: false; motivo: string };

/** Confere esquema, porta, credenciais e host literal (sem DNS). Serve para hosts fixos e confiáveis. */
export function validarLiteral(url: URL): ValidacaoDestino {
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, motivo: "esquema não permitido" };
  if (url.username || url.password) return { ok: false, motivo: "credenciais na URL" };
  const porta = url.port === "" ? (url.protocol === "https:" ? "443" : "80") : url.port;
  if (porta !== "80" && porta !== "443") return { ok: false, motivo: "porta não permitida" };
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, motivo: "host vazio" };
  if (isIP(host)) return ipBloqueado(host) ? { ok: false, motivo: "IP bloqueado" } : { ok: true, ips: [host] };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) {
    return { ok: false, motivo: "host local" };
  }
  return { ok: true, ips: [] };
}

/** Confere o destino e resolve o DNS uma única vez; devolve os IPs validados para fixar na conexão. */
export async function validarDestino(url: URL, dns: ResolvedorDns): Promise<ValidacaoDestino> {
  const v = validarLiteral(url);
  if (!v.ok || v.ips.length > 0) return v;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  let ips: string[];
  try {
    ips = await dns(host);
  } catch {
    return { ok: false, motivo: "DNS falhou" };
  }
  if (ips.length === 0) return { ok: false, motivo: "DNS sem resposta" };
  if (ips.some(ipBloqueado)) return { ok: false, motivo: "resolve para IP bloqueado" };
  return { ok: true, ips };
}

// ---------------------------------------------------------------------------
// Redirecionamentos manuais
// ---------------------------------------------------------------------------

export interface ContextoRede {
  dns: ResolvedorDns;
  transporte: Transporte;
  /** Só hosts para os quais isto devolve true recebem requisição (encurtadores). Os demais nunca são tocados. */
  consultar: (url: URL) => boolean;
  /** Prazo geral: aborta tudo quando estoura. */
  signal?: AbortSignal;
}

export interface ResolucaoLink {
  status: "ok" | "bloqueado" | "falha" | "limite";
  /** URLs visitadas, da inicial até a última. */
  cadeia: string[];
  /** Última URL alcançada (só quando status = ok). */
  final?: string;
  motivo?: string;
}

export interface OpcoesSalto {
  maxSaltos?: number;
  timeoutSaltoMs?: number;
}

function sinalComPrazo(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

/**
 * Segue redirecionamentos de encurtadores à mão: HEAD (GET só se o servidor recusar HEAD com 405/501),
 * sem ler o corpo, validando cada salto contra SSRF e fixando o IP validado na conexão.
 * Quando o destino não é um encurtador, a cadeia termina ali SEM requisição ao site.
 */
export async function seguirRedirecionamentos(inicial: URL, ctx: ContextoRede, opcoes: OpcoesSalto = {}): Promise<ResolucaoLink> {
  const maxSaltos = opcoes.maxSaltos ?? 5;
  const timeout = opcoes.timeoutSaltoMs ?? 3000;
  let atual = inicial;
  const cadeia = [atual.href];
  for (let saltos = 0; ; saltos++) {
    const literal = validarLiteral(atual);
    if (!literal.ok) return { status: "bloqueado", cadeia, motivo: literal.motivo };
    if (!ctx.consultar(atual)) return { status: "ok", cadeia, final: atual.href };
    const v = await validarDestino(atual, ctx.dns);
    if (!v.ok) return { status: "bloqueado", cadeia, motivo: v.motivo };
    const ip = v.ips[0]!;
    let res: RespostaSalto;
    try {
      res = await ctx.transporte({ url: atual, metodo: "HEAD", ip, signal: sinalComPrazo(ctx.signal, timeout) });
      if (res.status === 405 || res.status === 501) {
        res = await ctx.transporte({ url: atual, metodo: "GET", ip, signal: sinalComPrazo(ctx.signal, timeout) });
      }
    } catch (e) {
      return { status: "falha", cadeia, motivo: e instanceof Error ? e.name : "erro" };
    }
    if (res.status >= 300 && res.status < 400 && res.location) {
      if (saltos >= maxSaltos) return { status: "limite", cadeia, motivo: "saltos demais" };
      let prox: URL;
      try {
        prox = new URL(res.location, atual);
      } catch {
        return { status: "falha", cadeia, motivo: "Location inválido" };
      }
      cadeia.push(prox.href);
      atual = prox;
      continue;
    }
    return { status: "ok", cadeia, final: atual.href };
  }
}
