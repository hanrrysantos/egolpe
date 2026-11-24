import { passosAntes } from "./roteiros";
import type { Evidencia, Extracao, Motivo, Nivel, TipoGolpe, Veredito } from "./tipos";

/** Resultado da síntese antes das guardas: o modelo escolhe nível, tipo e motivos; nunca o texto do roteiro. */
export interface ResultadoSintese {
  nivel: Nivel;
  tipo: TipoGolpe;
  motivos: Motivo[];
}

/**
 * Regras que valem qualquer que seja a resposta do modelo:
 * - motivo sem evidência é descartado;
 * - "seguro" com qualquer alerta de sinal vira "suspeito";
 * - "seguro" com tentativa de manipulação, pedido de dados sensíveis ou
 *   pedido de dinheiro de quem diz ter trocado de número vira "suspeito";
 * - "golpe" ou "suspeito" sem nenhum motivo vira "suspeito" com motivo genérico;
 * - "seguro" sempre tem tipo "nenhum"; os outros níveis nunca têm;
 * - o_que_fazer vem sempre do roteiro fixo.
 */
export function aplicarGuardas(sintese: ResultadoSintese, evidencias: Evidencia[], extracao?: Extracao): Veredito {
  const motivos = sintese.motivos.filter((m) => m.texto.trim() !== "" && m.evidencia.trim() !== "");
  let nivel = sintese.nivel;
  let tipo = sintese.tipo;

  const temAlerta = evidencias.some((e) => e.resultado === "alerta");
  const extracaoProibeSeguro =
    !!extracao &&
    (extracao.tentativaDeManipulacao ||
      extracao.pedeDadosSensiveis ||
      (extracao.pedeDinheiro && !!extracao.remetente?.trocouDeNumero));
  if (nivel === "seguro" && (temAlerta || extracaoProibeSeguro)) {
    nivel = "suspeito";
    if (tipo === "nenhum" && extracao) tipo = extracao.tipoProvavel;
  }

  if (nivel !== "seguro" && motivos.length === 0) {
    nivel = "suspeito";
    const alerta = evidencias.find((e) => e.resultado === "alerta");
    motivos.push({
      texto: "Não deu para confirmar que esta mensagem é segura.",
      evidencia: alerta?.descricao ?? "a análise não encontrou confirmação de que a mensagem é legítima",
    });
  }

  if (nivel === "seguro") tipo = "nenhum";
  else if (tipo === "nenhum") tipo = "outro";

  return { nivel, tipo, motivos, o_que_fazer: passosAntes(tipo) };
}
