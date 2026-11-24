import { getDomain } from "tldts";
import type { Evidencia, Marca, Sinal } from "@/src/nucleo/tipos";
import { ehEncurtador, resolverLinks, urlsParaVerificar, type ContextoInterno } from "./links";
import { analisarHost, encontrarMarcaAlegada } from "./marcas";

export function nomeExibido(host: string): string {
  return host.replace(/^www\./, "");
}

function dominioDe(host: string): string {
  return getDomain(host) ?? host;
}

/** Sinal `link_encurtado`: para onde o link realmente leva. */
export function criarSinalLinkEncurtado(): Sinal {
  return {
    id: "link_encurtado",
    async verificar(extracao, ctx) {
      try {
        const links = await resolverLinks(extracao, ctx as ContextoInterno);
        const out: Evidencia[] = [];
        for (const l of links) {
          const origem = nomeExibido(l.original.hostname);
          if (l.final) {
            const destino = nomeExibido(l.final.hostname);
            const mudouSite = dominioDe(l.original.hostname) !== dominioDe(l.final.hostname);
            if (l.encurtador || mudouSite) {
              out.push({
                sinal: "link_encurtado",
                resultado: "alerta",
                forca: "moderada",
                alvo: l.original.href,
                descricao: l.encurtador
                  ? `o link curto leva, na verdade, para ${destino}`
                  : `o link ${origem} leva, na verdade, para ${destino}`,
                detalhes: { destino, saltos: l.resolucao.cadeia.length - 1 },
              });
            }
          } else if (l.encurtador) {
            out.push({
              sinal: "link_encurtado",
              resultado: "sem_resultado",
              alvo: l.original.href,
              descricao: "o link é encurtado e não foi possível ver para onde ele leva",
              detalhes: { situacao: l.resolucao.status },
            });
          }
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}

function marcaAlegada(extracao: { remetente?: { marca?: string } }, marcas: Marca[]): Marca | undefined {
  return encontrarMarcaAlegada(extracao.remetente?.marca, marcas);
}

/** Sinal `dominio_oficial`: o link é do site oficial da marca? */
export function criarSinalDominioOficial(marcas: Marca[]): Sinal {
  return {
    id: "dominio_oficial",
    async verificar(extracao, ctx) {
      try {
        const links = await resolverLinks(extracao, ctx as ContextoInterno);
        const alegada = marcaAlegada(extracao, marcas);
        const out: Evidencia[] = [];
        const vistos = new Set<string>();
        for (const u of urlsParaVerificar(links)) {
          const host = u.hostname.toLowerCase();
          if (ehEncurtador(host) || vistos.has(host)) continue;
          vistos.add(host);
          const a = analisarHost(host, marcas, alegada);
          const dominio = nomeExibido(dominioDe(host));
          if (a.tipo === "oficial") {
            if (a.marca.conferido) {
              out.push({
                sinal: "dominio_oficial",
                resultado: "confirmacao",
                forca: "forte",
                alvo: dominio,
                marca: a.marca.id,
                descricao: `o link é do site oficial da ${a.marca.nomePopular}`,
              });
            } else {
              out.push({
                sinal: "dominio_oficial",
                resultado: "sem_resultado",
                alvo: dominio,
                marca: a.marca.id,
                descricao: `o link parece ser do site da ${a.marca.nomePopular}, mas esse endereço ainda não foi conferido`,
              });
            }
          } else if (a.tipo === "outro" && alegada) {
            out.push({
              sinal: "dominio_oficial",
              resultado: "alerta",
              forca: "moderada",
              alvo: dominio,
              marca: alegada.id,
              descricao: `a mensagem diz ser da ${alegada.nomePopular}, mas o link leva para ${dominio}, que não é um site dela`,
            });
          }
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}

/** Sinal `semelhanca_dominio`: o endereço imita o de uma marca conhecida? */
export function criarSinalSemelhanca(marcas: Marca[]): Sinal {
  return {
    id: "semelhanca_dominio",
    async verificar(extracao, ctx) {
      try {
        const links = await resolverLinks(extracao, ctx as ContextoInterno);
        const alegada = marcaAlegada(extracao, marcas);
        const out: Evidencia[] = [];
        const vistos = new Set<string>();
        for (const u of urlsParaVerificar(links)) {
          const host = u.hostname.toLowerCase();
          if (ehEncurtador(host) || vistos.has(host)) continue;
          vistos.add(host);
          const a = analisarHost(host, marcas, alegada);
          if (a.tipo !== "imitacao") continue;
          const dominio = nomeExibido(dominioDe(host));
          out.push({
            sinal: "semelhanca_dominio",
            resultado: "alerta",
            forca: "forte",
            alvo: dominio,
            marca: a.marca.id,
            descricao: `o endereço ${dominio} parece o site da ${a.marca.nomePopular}, mas não é`,
            detalhes: { motivo: a.motivo },
          });
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}
