import type Anthropic from "@anthropic-ai/sdk";
import { vi } from "vitest";

/** Só para testes: cliente Anthropic falso, com `messages.create` devolvendo respostas prontas. */
export interface RespostaFalsa {
  stop_reason?: string;
  /** Objeto serializado como JSON no bloco de texto, ou texto cru. */
  corpo?: unknown;
}

export function clienteFalso(...respostas: RespostaFalsa[]) {
  const create = vi.fn();
  for (const r of respostas) {
    const texto = typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo ?? {});
    create.mockResolvedValueOnce({
      id: "msg_teste",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      stop_reason: r.stop_reason ?? "end_turn",
      stop_details: r.stop_reason === "refusal" ? { type: "refusal", category: null, explanation: null } : null,
      content: r.stop_reason === "refusal" ? [] : [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: texto }],
      usage: { input_tokens: 1000, output_tokens: 200 },
    });
  }
  const cliente = { messages: { create } } as unknown as Anthropic;
  return { cliente, create };
}

/** Saída de extração válida, no formato do modelo, com campos vazios. */
export function extracaoModeloVazia() {
  return {
    links: [] as string[],
    chavesPix: [] as { valor: string; tipo: string; titular: string }[],
    linhasDigitaveis: [] as string[],
    telefones: [] as { numero: string; contexto: string }[],
    remetente: { descricao: "", parentesco: "", marca: "", trocouDeNumero: false },
    pedeDinheiro: false,
    valor: "",
    pedeDadosSensiveis: false,
    urgencia: [] as string[],
    trechos: [] as string[],
    tipoProvavel: "nenhum",
    tentativaDeManipulacao: false,
  };
}
