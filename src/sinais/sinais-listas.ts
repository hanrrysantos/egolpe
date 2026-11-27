import type { Evidencia, Sinal } from "@/src/nucleo/tipos";
import openphishJson from "@/dados/openphish.json";
import { parse } from "tldts";
import { urlsParaVerificar, type ResolvedorLinks } from "./links";
import { nomeExibido } from "./sinais-dominio";

export const FEED_OPENPHISH: string[] = openphishJson as unknown as string[];

const ENDPOINT_SB = "https://safebrowsing.googleapis.com/v4/threatMatches:find";

/** Só os links vão para o Google: nada da conversa. */
export function criarSinalSafeBrowsing(resolverLinks: ResolvedorLinks, chave: () => string | undefined = () => process.env.GOOGLE_SAFE_BROWSING_API_KEY): Sinal {
  return {
    id: "safe_browsing",
    async verificar(extracao, ctx) {
      try {
        const urls = urlsParaVerificar(await resolverLinks(extracao, ctx)).map((u) => u.href);
        if (urls.length === 0) return [];
        const k = chave();
        const semResultado = (u: string): Evidencia => ({
          sinal: "safe_browsing",
          resultado: "sem_resultado",
          alvo: u,
          descricao: "não foi possível consultar a lista de sites perigosos do Google",
        });
        if (!k) return urls.map(semResultado);
        try {
          const res = await ctx.fetch(`${ENDPOINT_SB}?key=${encodeURIComponent(k)}`, {
            method: "POST",
            redirect: "manual",
            headers: { "content-type": "application/json" },
            signal: AbortSignal.any([AbortSignal.timeout(3000), ...(ctx.signal ? [ctx.signal] : [])]),
            body: JSON.stringify({
              client: { clientId: "verificador-de-links", clientVersion: "1.0.0" },
              threatInfo: {
                threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
                platformTypes: ["ANY_PLATFORM"],
                threatEntryTypes: ["URL"],
                threatEntries: urls.map((url) => ({ url })),
              },
            }),
          });
          if (!res.ok) {
            await res.body?.cancel().catch(() => {});
            return urls.map(semResultado);
          }
          const j = (await res.json()) as { matches?: { threat?: { url?: string }; threatType?: string }[] };
          const achados = new Map<string, string>();
          for (const m of j.matches ?? []) if (m.threat?.url) achados.set(m.threat.url, m.threatType ?? "");
          return urls.map((u): Evidencia => {
            const tipo = achados.get(u);
            if (tipo !== undefined) {
              return {
                sinal: "safe_browsing",
                resultado: "alerta",
                forca: "forte",
                alvo: u,
                descricao: "o Google marcou esse link como perigoso",
                detalhes: { tipoAmeaca: tipo },
              };
            }
            return { sinal: "safe_browsing", resultado: "neutro", alvo: u, descricao: "o link não aparece na lista de sites perigosos do Google (isso não garante que seja seguro)" };
          });
        } catch {
          return urls.map(semResultado);
        }
      } catch {
        return [];
      }
    },
  };
}

export function normalizarUrlLista(bruto: string): { url: string; host: string } | null {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(bruto.trim()) ? bruto.trim() : `http://${bruto.trim()}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    const caminho = u.pathname.replace(/\/+$/, "");
    return { url: `${host}${caminho}${u.search}`, host };
  } catch {
    return null;
  }
}

/** Hosts em que qualquer pessoa publica conteúdo: casar só pelo host acusaria sites legítimos. */
const HOSPEDAGEM_COMPARTILHADA = new Set([
  "docs.google.com", "sites.google.com", "drive.google.com", "forms.gle", "forms.google.com", "storage.googleapis.com",
  "firebaseapp.com", "web.app", "github.io", "githubusercontent.com", "vercel.app", "netlify.app", "pages.dev", "workers.dev",
  "herokuapp.com", "blogspot.com", "wixsite.com", "weebly.com", "notion.site", "onrender.com", "glitch.me", "000webhostapp.com",
  "typeform.com", "canva.com", "wordpress.com", "bit.ly", "tinyurl.com", "t.co", "cutt.ly",
  "amazonaws.com", "azurewebsites.net", "r2.dev",
  "linktr.ee", "carrd.co", "webflow.io", "framer.website", "replit.app", "supabase.co",
  "sharepoint.com", "onedrive.live.com", "dropbox.com",
]);

export function hostCompartilhado(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const partes = h.split(".");
  for (let i = 0; i < partes.length - 1; i++) if (HOSPEDAGEM_COMPARTILHADA.has(partes.slice(i).join("."))) return true;
  const p = parse(h, { allowPrivateDomains: true });
  return p.isPrivate === true;
}

const indices = new WeakMap<string[], { urls: Set<string>; hosts: Set<string> }>();

function indexar(feed: string[]) {
  let i = indices.get(feed);
  if (!i) {
    i = { urls: new Set(), hosts: new Set() };
    for (const bruto of feed) {
      const n = normalizarUrlLista(bruto);
      if (n) {
        i.urls.add(n.url);
        i.hosts.add(n.host);
      }
    }
    indices.set(feed, i);
  }
  return i;
}

/** Feed comunitário do OpenPhish, consultado localmente. Ausência na lista não é prova de segurança. */
export function criarSinalOpenPhish(resolverLinks: ResolvedorLinks, feed: string[] = FEED_OPENPHISH): Sinal {
  return {
    id: "openphish",
    async verificar(extracao, ctx) {
      try {
        const urls = urlsParaVerificar(await resolverLinks(extracao, ctx));
        if (urls.length === 0) return [];
        const idx = indexar(feed);
        return urls.map((u): Evidencia => {
          const n = normalizarUrlLista(u.href);
          const exata = !!n && idx.urls.has(n.url);
          const host = !!n && idx.hosts.has(n.host) && !hostCompartilhado(u.hostname);
          if (exata || host) {
            return {
              sinal: "openphish",
              resultado: "alerta",
              // só o host casou (outro caminho do mesmo site): indício menor do que a URL exata
              forca: exata ? "forte" : "moderada",
              alvo: u.href,
              descricao: `o site ${nomeExibido(u.hostname)} aparece numa lista pública de golpes (phishing)`,
              detalhes: { correspondencia: exata ? "url" : "host" },
            };
          }
          return { sinal: "openphish", resultado: "neutro", alvo: u.href, descricao: "o link não aparece na lista pública de golpes (isso não garante que seja seguro)" };
        });
      } catch {
        return [];
      }
    },
  };
}
