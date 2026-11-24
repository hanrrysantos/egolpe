import roteirosJson from "@/dados/roteiros.json";
import type { Roteiro, TipoComRoteiro, TipoGolpe } from "./tipos";

const roteiros = roteirosJson as Roteiro[];

/** Orientação básica: usada em falhas, no limite de uso e quando não há roteiro. */
export const ORIENTACAO_BASICA: string[] = [
  "Não faça nenhum Pix nem pagamento por enquanto.",
  "Não clique em links da mensagem.",
  "Ligue para o seu banco pelo número que está no verso do seu cartão.",
];

export function obterRoteiro(tipo: TipoGolpe): Roteiro | undefined {
  if (tipo === "nenhum") return undefined;
  return roteiros.find((r) => r.tipo === tipo);
}

/** Passos "ainda não fez nada" para o veredito. */
export function passosAntes(tipo: TipoGolpe): string[] {
  if (tipo === "nenhum") return [];
  return obterRoteiro(tipo)?.antes ?? ORIENTACAO_BASICA;
}

/** Passos "já paguei / já cliquei" para o botão. */
export function passosDepois(tipo: TipoGolpe): string[] {
  const tipoRoteiro: TipoComRoteiro = tipo === "nenhum" ? "outro" : tipo;
  return obterRoteiro(tipoRoteiro)?.depois ?? obterRoteiro("outro")?.depois ?? ORIENTACAO_BASICA;
}
