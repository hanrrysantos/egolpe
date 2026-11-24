import type { Evidencia, Marca, Sinal } from "@/src/nucleo/tipos";
import { encontrarMarcaAlegada } from "./marcas";

/** Só dígitos, sem +55 nem zero de operadora; mantém 0800/0300. */
export function normalizarTelefone(bruto: string): string {
  let d = bruto.replace(/\D/g, "");
  if (d.startsWith("0055")) d = d.slice(4);
  else if (d.startsWith("55") && d.length >= 12 && !d.startsWith("550")) d = d.slice(2);
  else if (d.startsWith("55") && d.length === 13 && d[2] === "0") d = d.slice(2);
  // zero de longa distância antes do DDD (011..., 021...) – não mexe em 0800/0300/0500/0900
  if (/^0[1-9]\d/.test(d) && d.length >= 11 && !/^0[3589]00/.test(d)) d = d.slice(1);
  return d;
}

export function telefonesBatem(numero: string, oficial: string): boolean {
  const a = normalizarTelefone(numero);
  const b = normalizarTelefone(oficial);
  if (!a || !b) return false;
  if (a === b) return true;
  // oficial sem DDD (ex.: 4004 0001) ligado com DDD de 2 dígitos
  return b.length >= 8 && b.length <= 9 && a.length === b.length + 2 && a.endsWith(b);
}

/** Sinal `telefone_oficial`: o número da mensagem é o da central da marca? */
export function criarSinalTelefone(marcas: Marca[]): Sinal {
  return {
    id: "telefone_oficial",
    async verificar(extracao) {
      try {
        const alegada = encontrarMarcaAlegada(extracao.remetente?.marca, marcas);
        const out: Evidencia[] = [];
        const vistos = new Set<string>();
        for (const t of extracao.telefones) {
          const considerar = t.contexto === "ligar_para" || (t.contexto === "outro" && alegada?.categoria === "banco");
          if (!considerar) continue;
          const alvo = normalizarTelefone(t.numero);
          if (!alvo || vistos.has(alvo)) continue;
          vistos.add(alvo);

          if (alegada) {
            if (!alegada.conferido || alegada.telefones.length === 0) {
              out.push({
                sinal: "telefone_oficial",
                resultado: "sem_resultado",
                alvo,
                marca: alegada.id,
                descricao: `não foi possível conferir se esse número é o da ${alegada.nomePopular}`,
              });
            } else if (alegada.telefones.some((o) => telefonesBatem(alvo, o.numero))) {
              out.push({
                sinal: "telefone_oficial",
                resultado: "confirmacao",
                forca: "forte",
                alvo,
                marca: alegada.id,
                descricao: `esse número é um dos telefones oficiais da ${alegada.nomePopular}`,
              });
            } else if (alegada.categoria === "banco") {
              out.push({
                sinal: "telefone_oficial",
                resultado: "alerta",
                forca: "forte",
                alvo,
                marca: alegada.id,
                descricao: `esse número não é o da central oficial do ${alegada.nomePopular}`,
              });
            } else {
              out.push({
                sinal: "telefone_oficial",
                resultado: "sem_resultado",
                alvo,
                marca: alegada.id,
                descricao: `não foi possível conferir se esse número é o da ${alegada.nomePopular}`,
              });
            }
            continue;
          }
          const dona = marcas.find((m) => m.conferido && m.telefones.some((o) => telefonesBatem(alvo, o.numero)));
          out.push(
            dona
              ? {
                  sinal: "telefone_oficial",
                  resultado: "confirmacao",
                  forca: "moderada",
                  alvo,
                  marca: dona.id,
                  descricao: `esse número é um dos telefones oficiais da ${dona.nomePopular}`,
                }
              : { sinal: "telefone_oficial", resultado: "sem_resultado", alvo, descricao: "não foi possível conferir de quem é esse número" },
          );
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}
