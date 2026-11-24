import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { ModeloClaude } from "@/src/nucleo/tipos";

/**
 * Erro das etapas de IA. O núcleo registra só `name` em log (ver `descreverErro`),
 * por isso o motivo vai no nome e a mensagem nunca contém conteúdo do usuário nem da resposta.
 */
export class ErroModelo extends Error {
  constructor(
    readonly motivo: "recusa" | "max_tokens" | "parada_inesperada" | "sem_texto" | "json_invalido" | "schema_invalido",
    detalhe?: string,
  ) {
    super(detalhe ? `${motivo}: ${detalhe}` : motivo);
    this.name = `ErroModelo.${motivo}`;
  }
}

export interface ChamadaJson<T> {
  cliente: Anthropic;
  modelo: ModeloClaude;
  signal?: AbortSignal;
  system: string;
  conteudo: Anthropic.ContentBlockParam[];
  /** JSON Schema enviado em `output_config.format` (saída estruturada). */
  schemaJson: Record<string, unknown>;
  /** Schema zod que valida a resposta de novo, em código. */
  schemaZod: z.ZodType<T>;
  maxTokens: number;
}

/**
 * Faz uma chamada com saída estruturada e valida a resposta.
 * Lança `ErroModelo` em recusa, corte por `max_tokens`, JSON inválido ou fora do schema;
 * erros da API (rede, 429, 5xx, cancelamento) sobem como vieram do SDK.
 */
export async function chamarModeloJson<T>(c: ChamadaJson<T>): Promise<T> {
  const resposta = await c.cliente.messages.create(
    {
      model: c.modelo,
      max_tokens: c.maxTokens,
      system: c.system,
      messages: [{ role: "user", content: c.conteudo }],
      // Tarefa curta de leitura e classificação: esforço baixo reduz latência e custo de raciocínio.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: c.schemaJson },
      },
    },
    { signal: c.signal },
  );

  if (resposta.stop_reason === "refusal") throw new ErroModelo("recusa");
  if (resposta.stop_reason === "max_tokens") throw new ErroModelo("max_tokens");
  if (resposta.stop_reason !== "end_turn") throw new ErroModelo("parada_inesperada");

  const texto = resposta.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
  if (!texto) throw new ErroModelo("sem_texto");

  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw new ErroModelo("json_invalido");
  }

  const r = c.schemaZod.safeParse(bruto);
  if (!r.success) {
    // Só os caminhos dos campos: as mensagens do zod podem ecoar valores vindos do conteúdo analisado.
    const caminhos = [...new Set(r.error.issues.map((i) => i.path.join(".") || "(raiz)"))].slice(0, 5);
    throw new ErroModelo("schema_invalido", caminhos.join(", "));
  }
  return r.data;
}

/** Tags usadas como delimitadores nos prompts. Qualquer ocorrência delas no conteúdo é neutralizada. */
const TAGS_DELIMITADORAS = ["mensagem_suspeita", "imagem_suspeita", "dados_para_analise", "extracao", "evidencias"];
const RE_TAG = new RegExp(`<\\s*/?\\s*(?:${TAGS_DELIMITADORAS.join("|")})\\b[^>]*>`, "gi");

/**
 * Impede que o conteúdo feche (ou abra) um delimitador do prompt:
 * troca os sinais de menor/maior das tags delimitadoras por ‹ ›.
 */
export function neutralizarDelimitadores(texto: string): string {
  return texto.replace(RE_TAG, (tag) => tag.replace(/</g, "‹").replace(/>/g, "›"));
}
