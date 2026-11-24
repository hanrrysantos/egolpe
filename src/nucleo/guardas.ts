import { passosAntes } from "./roteiros";
import type { Evidencia, Extracao, Motivo, Nivel, TipoGolpe, Veredito } from "./tipos";

/** Resultado da síntese antes das guardas: o modelo escolhe nível, tipo e motivos; nunca o texto do roteiro. */
export interface ResultadoSintese {
  nivel: Nivel;
  tipo: TipoGolpe;
  motivos: Motivo[];
}

function hostDe(link: string): string | undefined {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(link) ? link : `http://${link}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Link coberto por uma confirmação de sinal (ex.: domínio oficial conferido). */
function linkConfirmado(link: string, confirmacoes: Evidencia[]): boolean {
  const host = hostDe(link);
  return confirmacoes.some((e) => {
    const alvo = e.alvo.toLowerCase();
    if (alvo === link.toLowerCase()) return true;
    const hostAlvo = hostDe(alvo) ?? alvo;
    return !!host && (host === hostAlvo || host.endsWith(`.${hostAlvo}`));
  });
}

function telefoneConfirmado(numero: string, confirmacoes: Evidencia[]): boolean {
  const digitos = numero.replace(/\D/g, "");
  if (digitos.length < 8) return false;
  return confirmacoes.some(
    (e) => e.sinal === "telefone_oficial" && e.alvo.replace(/\D/g, "").endsWith(digitos.slice(-8)),
  );
}

/**
 * Motivos pelos quais "seguro" não pode ser dado, mesmo que o modelo diga.
 * 🟢 exige evidência; na dúvida, 🟡.
 */
export function impedimentosDeSeguro(evidencias: Evidencia[], extracao?: Extracao): string[] {
  const impedimentos: string[] = [];
  if (evidencias.some((e) => e.resultado === "alerta")) impedimentos.push("alerta");
  if (!extracao) return impedimentos;
  if (extracao.tentativaDeManipulacao) impedimentos.push("manipulacao");
  if (extracao.pedeDadosSensiveis) impedimentos.push("dados_sensiveis");
  if (extracao.pedeDinheiro && (extracao.remetente?.trocouDeNumero || extracao.chavesPix.length > 0)) {
    impedimentos.push("pede_dinheiro");
  }
  if (extracao.linhasDigitaveis.length > 0) impedimentos.push("boleto_nao_verificavel");
  const confirmacoes = evidencias.filter((e) => e.resultado === "confirmacao");
  if (extracao.links.some((l) => !linkConfirmado(l, confirmacoes))) impedimentos.push("link_nao_confirmado");
  if (extracao.telefones.some((t) => t.contexto === "ligar_para" && !telefoneConfirmado(t.numero, confirmacoes))) {
    impedimentos.push("telefone_nao_confirmado");
  }
  return impedimentos;
}

/**
 * Regras que valem qualquer que seja a resposta do modelo:
 * - motivo sem evidência é descartado;
 * - "seguro" exige ao menos um motivo com evidência e nenhum impedimento
 *   (alerta, manipulação, pedido de dados, pedido de dinheiro com Pix ou troca de número,
 *   boleto, link ou telefone "ligue para" sem confirmação de sinal). Senão vira "suspeito"
 *   e os motivos escritos para justificar "seguro" são descartados;
 * - "golpe" ou "suspeito" sem nenhum motivo vira "suspeito" com motivo genérico;
 * - "seguro" sempre tem tipo "nenhum"; os outros níveis nunca têm;
 * - o_que_fazer vem sempre do roteiro fixo.
 */
export function aplicarGuardas(sintese: ResultadoSintese, evidencias: Evidencia[], extracao?: Extracao): Veredito {
  let motivos = sintese.motivos.filter((m) => m.texto.trim() !== "" && m.evidencia.trim() !== "");
  let nivel = sintese.nivel;
  let tipo = sintese.tipo;

  if (nivel === "seguro" && (motivos.length === 0 || impedimentosDeSeguro(evidencias, extracao).length > 0)) {
    nivel = "suspeito";
    motivos = [];
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
