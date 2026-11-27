import { domainToUnicode } from "node:url";
import { parse } from "tldts";
import type { Marca } from "@/src/nucleo/tipos";
import bancosJson from "@/dados/bancos.json";
import marcasJson from "@/dados/marcas.json";

/** Base dedicada de instituições bancárias e de pagamento (consultada localmente para evitar buscas na web). */
export const BANCOS: Marca[] = bancosJson as unknown as Marca[];

const idsBancos = new Set(BANCOS.map((b) => b.id));
const outrasMarcas = (marcasJson as unknown as Marca[]).filter((m) => !idsBancos.has(m.id));

/** Base completa: instituições bancárias conferidas + demais marcas (governo, entrega, lojas). */
export const MARCAS: Marca[] = [...BANCOS, ...outrasMarcas];

/** Busca local por código COMPE (3 dígitos) na base de instituições bancárias. */
export function buscarBancoPorCodigo(codigo: string, bancos: Marca[] = BANCOS): Marca | undefined {
  const c = codigo.replace(/\D/g, "").padStart(3, "0");
  return bancos.find((b) => b.codigoBanco === c);
}

/** Busca local por nome/apelido na base de instituições bancárias. */
export function buscarBancoPorNome(texto: string | undefined, bancos: Marca[] = BANCOS): Marca | undefined {
  return encontrarMarcaAlegada(texto, bancos);
}

export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Casa o texto livre de `remetente.marca` com uma marca da base. */
export function encontrarMarcaAlegada(texto: string | undefined, marcas: Marca[]): Marca | undefined {
  if (!texto) return undefined;
  const t = normalizar(texto);
  if (!t) return undefined;
  const compacto = t.replace(/[^a-z0-9]/g, "");
  let melhor: { m: Marca; peso: number } | undefined;
  for (const m of marcas) {
    const nomes = [m.id, m.nomePopular, m.nome, ...m.palavrasChave].map(normalizar);
    for (const n of nomes) {
      const nc = n.replace(/[^a-z0-9]/g, "");
      if (!nc) continue;
      let peso = 0;
      if (n === t || nc === compacto) peso = 1000 + nc.length;
      else if (nc.length >= 3 && new RegExp(`(^|[^a-z0-9])${n.replace(/[^a-z0-9 ]/g, ".")}([^a-z0-9]|$)`).test(t)) peso = nc.length;
      if (peso > (melhor?.peso ?? 0)) melhor = { m, peso };
    }
  }
  return melhor?.m;
}

// ---------------------------------------------------------------------------
// Semelhança de domínio
// ---------------------------------------------------------------------------

const CONFUSAO_UNICODE: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", у: "y", і: "i", ѕ: "s", ј: "j", ӏ: "l", ɑ: "a", ı: "i", ο: "o", ν: "v", ρ: "p", α: "a",
};

function desconfundir(s: string): string {
  return [...s].map((c) => CONFUSAO_UNICODE[c] ?? c).join("");
}

function substituirHomoglifos(s: string, umParaI: boolean): string {
  return s
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/0/g, "o")
    .replace(/1/g, umParaI ? "i" : "l")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s");
}

/** Distância de edição com transposição (Damerau, versão restrita). */
export function distancia(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

export type AnaliseHost =
  | { tipo: "oficial"; marca: Marca }
  | { tipo: "imitacao"; marca: Marca; motivo: string }
  | { tipo: "outro" };

function ehOficial(host: string, marcas: Marca[]): Marca | undefined {
  let melhor: { m: Marca; tam: number } | undefined;
  for (const m of marcas) {
    for (const d of m.dominios) {
      const dd = d.toLowerCase();
      if ((host === dd || host.endsWith("." + dd)) && dd.length > (melhor?.tam ?? 0)) melhor = { m, tam: dd.length };
    }
  }
  return melhor?.m;
}

function palavrasDa(m: Marca): string[] {
  // Quando a marca define palavrasChave curadas, usa só elas para evitar falsos positivos
  // com nomes de domínio que coincidem com palavras comuns (ex.: inter.co -> internet, cora.com.br -> decoracao).
  const fonte =
    m.palavrasChave.length > 0
      ? m.palavrasChave
      : m.dominios.map((d) => parse(d).domainWithoutSuffix ?? "").filter((x) => x.length > 0);
  return [...new Set(fonte.map((p) => normalizar(p).replace(/[^a-z0-9]/g, "")).filter(Boolean))];
}

function casaPalavra(kw: string, tokens: string[], junto: string): boolean {
  if (kw.length >= 4) {
    if (junto.includes(kw)) return true;
    const tol = kw.length >= 9 ? 2 : 1;
    if (kw.length >= 5) return tokens.some((t) => t.length >= kw.length - 1 && t.length <= kw.length + 2 && distancia(t, kw) <= tol);
    return false;
  }
  return tokens.includes(kw);
}

/**
 * Classifica o host em relação à base: oficial, imitação (palavra da marca, erro de digitação ou
 * troca de letras parecidas) ou sem relação. `preferida` (marca alegada) vence empates.
 */
export function analisarHost(hostBruto: string, marcas: Marca[], preferida?: Marca): AnaliseHost {
  const host = hostBruto.toLowerCase().replace(/\.$/, "");
  const oficial = ehOficial(host, marcas);
  if (oficial) return { tipo: "oficial", marca: oficial };

  const unicode = desconfundir(normalizar(domainToUnicode(host) || host));
  const p = parse(unicode);
  const sufixo = p.publicSuffix ?? "";
  const semSufixo = sufixo && unicode.endsWith("." + sufixo) ? unicode.slice(0, -(sufixo.length + 1)) : sufixo === unicode ? "" : unicode;
  if (!semSufixo) return { tipo: "outro" };

  const tokensBase = semSufixo.split(/[^a-z0-9]+/).filter(Boolean);
  const variantes = [
    tokensBase,
    tokensBase.map((t) => substituirHomoglifos(t, false)),
    tokensBase.map((t) => substituirHomoglifos(t, true)),
  ];
  const ordem = preferida ? [preferida, ...marcas.filter((m) => m !== preferida)] : marcas;
  for (const m of ordem) {
    for (const kw of palavrasDa(m)) {
      for (let i = 0; i < variantes.length; i++) {
        const tokens = variantes[i]!;
        if (casaPalavra(kw, tokens, tokens.join(""))) {
          return { tipo: "imitacao", marca: m, motivo: i === 0 ? `contém "${kw}"` : `imita "${kw}" trocando letras parecidas` };
        }
      }
    }
  }
  return { tipo: "outro" };
}
