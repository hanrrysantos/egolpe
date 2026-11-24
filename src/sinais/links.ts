import { getDomain } from "tldts";
import type { ContextoSinais, Extracao } from "@/src/nucleo/tipos";
import { dnsPadrao, seguirRedirecionamentos, transporteNode, type ContextoRede, type ResolucaoLink, type ResolvedorDns, type Transporte } from "./rede";

export const ENCURTADORES = new Set([
  "bit.ly", "tinyurl.com", "cutt.ly", "encurtador.com.br", "t.co", "is.gd", "rebrand.ly", "s.id", "l1nk.dev",
  "goo.gl", "ow.ly", "buff.ly", "t.ly", "shorturl.at", "tiny.cc", "bl.ink", "rb.gy", "v.gd", "migre.me", "x.co",
  "wa.link", "qrco.de", "lnkd.in", "cli.re", "u.to",
]);

export const MAX_LINKS = 5;

/** Normaliza um link da extração: sem esquema vira http://; só http/https. */
export function normalizarLink(bruto: string): URL | null {
  let s = bruto.trim().replace(/[.,;:!?)\]}>"']+$/, "");
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s) && !/^[^/\s]+:\d+(\/|$)/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) s = "http://" + s.replace(/^\/\//, "");
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

export function ehEncurtador(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return ENCURTADORES.has(h) || ENCURTADORES.has(getDomain(h) ?? "");
}

export interface LinkResolvido {
  original: URL;
  encurtador: boolean;
  resolucao: ResolucaoLink;
  /** Destino final, se houve redirecionamento concluído. */
  final?: URL;
}

export function linksDaExtracao(extracao: Extracao): URL[] {
  const vistos = new Set<string>();
  const out: URL[] = [];
  for (const bruto of extracao.links) {
    const u = normalizarLink(bruto);
    if (!u || vistos.has(u.href)) continue;
    vistos.add(u.href);
    out.push(u);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

export interface DepsRede {
  dns: ResolvedorDns;
  transporte: Transporte;
}

/** Resolve os links da extração. Só encurtadores recebem requisição; o resto nunca é tocado. */
export type ResolvedorLinks = (extracao: Extracao, ctx: ContextoSinais) => Promise<LinkResolvido[]>;

const memo = new WeakMap<Extracao, { ctx: ContextoSinais; p: Promise<LinkResolvido[]> }>();

/** Fase 1: resolve os links uma única vez por (extração, contexto); compartilhado entre sinais. */
export function criarResolvedorLinks(deps: { dns?: ResolvedorDns; transporte?: Transporte } = {}): ResolvedorLinks {
  return (extracao, ctx) => {
    const guardado = memo.get(extracao);
    if (guardado && guardado.ctx === ctx) return guardado.p;
    const rede: ContextoRede = {
      dns: ctx.dns ?? deps.dns ?? dnsPadrao,
      transporte: deps.transporte ?? transporteNode,
      consultar: (u) => ehEncurtador(u.hostname),
      signal: ctx.signal,
    };
    const p = Promise.all(
      linksDaExtracao(extracao).map(async (original): Promise<LinkResolvido> => {
        let resolucao: ResolucaoLink;
        try {
          resolucao = await seguirRedirecionamentos(original, rede);
        } catch (e) {
          resolucao = { status: "falha", cadeia: [original.href], motivo: e instanceof Error ? e.name : "erro" };
        }
        const final = resolucao.status === "ok" && resolucao.final && resolucao.final !== original.href ? new URL(resolucao.final) : undefined;
        return { original, encurtador: ehEncurtador(original.hostname), resolucao, final };
      }),
    );
    memo.set(extracao, { ctx, p });
    return p;
  };
}

/** URLs a verificar nos demais sinais: originais e finais, sem duplicar. */
export function urlsParaVerificar(links: LinkResolvido[]): URL[] {
  const vistos = new Set<string>();
  const out: URL[] = [];
  for (const l of links) {
    for (const u of [l.original, l.final]) {
      if (u && !vistos.has(u.href)) {
        vistos.add(u.href);
        out.push(u);
      }
    }
  }
  return out;
}
