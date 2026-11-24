import { ORIENTACAO_BASICA } from "./roteiros";
import type { Veredito } from "./tipos";

/** Veredito usado quando a análise falha (erro, timeout, recusa do modelo). Nunca "seguro". */
export function vereditoDeFalha(): Veredito {
  return {
    nivel: "suspeito",
    tipo: "outro",
    motivos: [
      {
        texto: "Não consegui terminar a análise agora.",
        evidencia: "houve uma falha técnica do nosso lado; por segurança, trate a mensagem como suspeita",
      },
    ],
    o_que_fazer: ORIENTACAO_BASICA,
  };
}
