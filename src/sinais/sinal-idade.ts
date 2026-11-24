import { getDomain, parse } from "tldts";
import { isIP } from "node:net";
import type { Evidencia, Marca, Sinal } from "@/src/nucleo/tipos";
import { ehEncurtador, urlsParaVerificar, type ResolvedorLinks } from "./links";
import { analisarHost } from "./marcas";
import { validarLiteral } from "./rede";

const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const TIMEOUT_MS = 3000;
const MAX_DOMINIOS = 6;

/** Snapshot reduzido do bootstrap da IANA; as demais TLDs consultam o bootstrap. */
const SNAPSHOT: Record<string, string> = {
  br: "https://rdap.registro.br/",
  com: "https://rdap.verisign.com/com/v1/",
  net: "https://rdap.verisign.com/net/v1/",
  org: "https://rdap.publicinterestregistry.org/rdap/",
};

let bootstrapEmCache: Promise<Record<string, string> | null> | undefined;

/** Só para testes. */
export function limparCacheBootstrap(): void {
  bootstrapEmCache = undefined;
}

async function buscarJson(fetchFn: typeof fetch, url: string, signal?: AbortSignal): Promise<unknown> {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("não https");
  // RDAP e bootstrap são hosts fixos e conhecidos (o bootstrap vem da IANA): basta barrar IP literal/host local.
  const v = validarLiteral(u);
  if (!v.ok) throw new Error(v.motivo);
  const sinais = [AbortSignal.timeout(TIMEOUT_MS), ...(signal ? [signal] : [])];
  const res = await fetchFn(url, { redirect: "manual", signal: AbortSignal.any(sinais), headers: { accept: "application/rdap+json, application/json" } });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`http ${res.status}`);
  }
  return res.json();
}

function carregarBootstrap(fetchFn: typeof fetch, signal?: AbortSignal): Promise<Record<string, string> | null> {
  bootstrapEmCache ??= (async () => {
    try {
      const j = (await buscarJson(fetchFn, BOOTSTRAP_URL, signal)) as { services?: [string[], string[]][] };
      const mapa: Record<string, string> = {};
      for (const [tlds, urls] of j.services ?? []) {
        const url = urls.find((x) => x.startsWith("https://")) ?? urls[0];
        if (!url) continue;
        for (const t of tlds) mapa[t.toLowerCase()] = url.endsWith("/") ? url : url + "/";
      }
      return mapa;
    } catch {
      bootstrapEmCache = undefined;
      return null;
    }
  })();
  return bootstrapEmCache;
}

async function urlRdap(dominio: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<string | null> {
  const tld = dominio.split(".").pop() ?? "";
  let base: string | undefined = SNAPSHOT[tld];
  if (!base) base = (await carregarBootstrap(fetchFn, signal))?.[tld];
  return base ? `${base}domain/${encodeURIComponent(dominio)}` : null;
}

/** Data de registro (evento `registration`) via RDAP, ou null. */
export async function dataDeRegistro(dominio: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<Date | null> {
  try {
    const url = await urlRdap(dominio, fetchFn, signal);
    if (!url) return null;
    const j = (await buscarJson(fetchFn, url, signal)) as { events?: { eventAction?: string; eventDate?: string }[] };
    const ev = j.events?.find((e) => e.eventAction === "registration" && e.eventDate);
    if (!ev?.eventDate) return null;
    const d = new Date(ev.eventDate);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function descreverIdade(dias: number): string {
  if (dias <= 0) return "o site foi criado hoje";
  if (dias === 1) return "o site foi criado há 1 dia";
  if (dias < 60) return `o site foi criado há ${dias} dias`;
  if (dias < 730) return `o site foi criado há ${Math.floor(dias / 30)} meses`;
  return `o site foi criado há ${Math.floor(dias / 365)} anos`;
}

/** Sinal `idade_dominio`: há quanto tempo o site existe (RDAP, nunca WHOIS). */
export function criarSinalIdade(marcas: Marca[], resolverLinks: ResolvedorLinks): Sinal {
  return {
    id: "idade_dominio",
    async verificar(extracao, ctx) {
      try {
        const links = await resolverLinks(extracao, ctx);
        const dominios = new Set<string>();
        for (const u of urlsParaVerificar(links)) {
          const host = u.hostname.toLowerCase();
          if (isIP(host.replace(/^\[|\]$/g, "")) || ehEncurtador(host)) continue;
          const d = getDomain(host);
          if (!d || !parse(d).isIcann) continue;
          if (analisarHost(host, marcas).tipo === "oficial") continue;
          dominios.add(d);
        }
        const lista = [...dominios].slice(0, MAX_DOMINIOS);
        const evs = await Promise.all(
          lista.map(async (d): Promise<Evidencia> => {
            const criado = await dataDeRegistro(d, ctx.fetch, ctx.signal);
            if (!criado) {
              return { sinal: "idade_dominio", resultado: "sem_resultado", alvo: d, descricao: "não foi possível saber há quanto tempo o site existe" };
            }
            const dias = Math.floor((ctx.agora().getTime() - criado.getTime()) / 86_400_000);
            const base = { sinal: "idade_dominio" as const, alvo: d, descricao: descreverIdade(dias), detalhes: { diasDesdeCriacao: dias } };
            if (dias < 30) return { ...base, resultado: "alerta", forca: "forte" };
            if (dias <= 180) return { ...base, resultado: "alerta", forca: "moderada" };
            return { ...base, resultado: "neutro" };
          }),
        );
        return evs;
      } catch {
        return [];
      }
    },
  };
}
