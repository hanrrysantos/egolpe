import type { Evidencia, Marca, Sinal } from "@/src/nucleo/tipos";
import { encontrarMarcaAlegada } from "./marcas";

/** DV módulo 10 (pesos 2,1 da direita para a esquerda). */
export function dvModulo10(campo: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = campo.length - 1; i >= 0; i--) {
    const p = Number(campo[i]) * peso;
    soma += p > 9 ? p - 9 : p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

/** DV módulo 11 do código de barras (pesos 2..9); 0, 10 e 11 viram 1. */
export function dvModulo11(base: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const dv = 11 - (soma % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

export interface BoletoValidado {
  valido: boolean;
  banco: string;
  /** Qual verificação falhou, se alguma. */
  falha?: "campo1" | "campo2" | "campo3" | "geral";
}

/** Valida uma linha digitável bancária de 47 dígitos (só dígitos). */
export function validarLinhaDigitavel(d: string): BoletoValidado {
  const banco = d.slice(0, 3);
  const c1 = d.slice(0, 9), c2 = d.slice(10, 20), c3 = d.slice(21, 31);
  if (dvModulo10(c1) !== Number(d[9])) return { valido: false, banco, falha: "campo1" };
  if (dvModulo10(c2) !== Number(d[20])) return { valido: false, banco, falha: "campo2" };
  if (dvModulo10(c3) !== Number(d[31])) return { valido: false, banco, falha: "campo3" };
  const barras = d.slice(0, 4) + d.slice(33, 47) + d.slice(4, 9) + c2 + c3;
  if (dvModulo11(barras) !== Number(d[32])) return { valido: false, banco, falha: "geral" };
  return { valido: true, banco };
}

/** Sinal `boleto_banco`: números do boleto batem? O banco é o da marca alegada? */
export function criarSinalBoleto(marcas: Marca[]): Sinal {
  return {
    id: "boleto_banco",
    async verificar(extracao) {
      try {
        const alegada = encontrarMarcaAlegada(extracao.remetente?.marca, marcas);
        const out: Evidencia[] = [];
        const vistos = new Set<string>();
        for (const bruto of extracao.linhasDigitaveis) {
          const d = bruto.replace(/\D/g, "");
          if (!d || vistos.has(d)) continue;
          vistos.add(d);
          if (d.length === 47) {
            const v = validarLinhaDigitavel(d);
            const alvo = d;
            if (!v.valido) {
              out.push({
                sinal: "boleto_banco",
                resultado: "alerta",
                forca: "forte",
                alvo,
                descricao: "os números do boleto não batem: ele pode ter sido alterado",
                detalhes: { falha: v.falha ?? "" },
              });
              continue;
            }
            const doBanco = marcas.find((m) => m.codigoBanco === v.banco);
            const nomeBanco = doBanco?.nomePopular;
            const esperado = alegada?.codigoBanco;
            if (alegada && esperado && esperado !== v.banco) {
              out.push({
                sinal: "boleto_banco",
                resultado: "alerta",
                forca: "moderada",
                alvo,
                marca: alegada.id,
                descricao: `o boleto é do banco ${nomeBanco ?? `de código ${v.banco}`}, mas a mensagem diz ser do ${alegada.nomePopular}`,
                detalhes: { codigoBanco: v.banco, esperado },
              });
            } else {
              out.push({
                sinal: "boleto_banco",
                resultado: "neutro",
                alvo,
                marca: doBanco?.id,
                descricao: `os números do boleto batem${nomeBanco ? ` e ele é do banco ${nomeBanco}` : ""} (isso não garante que o valor e o destino sejam os certos)`,
                detalhes: { codigoBanco: v.banco },
              });
            }
          } else {
            out.push({
              sinal: "boleto_banco",
              resultado: "sem_resultado",
              alvo: d,
              descricao: d.length === 48 && d.startsWith("8") ? "esse tipo de boleto (conta de consumo) não é conferido aqui" : "não foi possível conferir esse número de boleto",
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
