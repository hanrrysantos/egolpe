import { z } from "zod";
import type { Extracao, TipoGolpe } from "@/src/nucleo/tipos";

/**
 * Formato que o modelo devolve na extração. Todos os campos são obrigatórios
 * (mais simples para a saída estruturada); "ausente" é string vazia, convertida depois para `undefined`.
 */

export const TIPOS_GOLPE = [
  "falso_parente",
  "falsa_central",
  "taxa_entrega",
  "boleto_adulterado",
  "governo_falso",
  "outro",
  "nenhum",
] as const satisfies readonly TipoGolpe[];

const TIPOS_CHAVE = ["cpf", "cnpj", "email", "telefone", "aleatoria", "desconhecido"] as const;
const CONTEXTOS_TELEFONE = ["ligar_para", "remetente", "outro"] as const;

/** Tamanho máximo de um trecho citável. */
export const MAX_TRECHO = 160;

export const schemaExtracaoModelo = z.object({
  links: z.array(z.string()),
  chavesPix: z.array(z.object({ valor: z.string(), tipo: z.enum(TIPOS_CHAVE), titular: z.string() })),
  linhasDigitaveis: z.array(z.string()),
  telefones: z.array(z.object({ numero: z.string(), contexto: z.enum(CONTEXTOS_TELEFONE) })),
  remetente: z.object({
    descricao: z.string(),
    parentesco: z.string(),
    marca: z.string(),
    trocouDeNumero: z.boolean(),
  }),
  pedeDinheiro: z.boolean(),
  valor: z.string(),
  pedeDadosSensiveis: z.boolean(),
  urgencia: z.array(z.string()),
  trechos: z.array(z.string()),
  tipoProvavel: z.enum(TIPOS_GOLPE),
  tentativaDeManipulacao: z.boolean(),
});

export type ExtracaoModelo = z.infer<typeof schemaExtracaoModelo>;

const str = { type: "string" } as const;
const strArr = { type: "array", items: str } as const;

/** JSON Schema equivalente, para `output_config.format`. */
export const jsonSchemaExtracao: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "links",
    "chavesPix",
    "linhasDigitaveis",
    "telefones",
    "remetente",
    "pedeDinheiro",
    "valor",
    "pedeDadosSensiveis",
    "urgencia",
    "trechos",
    "tipoProvavel",
    "tentativaDeManipulacao",
  ],
  properties: {
    links: strArr,
    chavesPix: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["valor", "tipo", "titular"],
        properties: { valor: str, tipo: { type: "string", enum: [...TIPOS_CHAVE] }, titular: str },
      },
    },
    linhasDigitaveis: strArr,
    telefones: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["numero", "contexto"],
        properties: { numero: str, contexto: { type: "string", enum: [...CONTEXTOS_TELEFONE] } },
      },
    },
    remetente: {
      type: "object",
      additionalProperties: false,
      required: ["descricao", "parentesco", "marca", "trocouDeNumero"],
      properties: { descricao: str, parentesco: str, marca: str, trocouDeNumero: { type: "boolean" } },
    },
    pedeDinheiro: { type: "boolean" },
    valor: str,
    pedeDadosSensiveis: { type: "boolean" },
    urgencia: strArr,
    trechos: strArr,
    tipoProvavel: { type: "string", enum: [...TIPOS_GOLPE] },
    tentativaDeManipulacao: { type: "boolean" },
  },
};

const vazioParaUndefined = (s: string): string | undefined => (s.trim() === "" ? undefined : s.trim());

/** Converte a saída do modelo para o tipo compartilhado `Extracao`. */
export function paraExtracao(m: ExtracaoModelo): Extracao {
  const descricao = vazioParaUndefined(m.remetente.descricao);
  const marca = vazioParaUndefined(m.remetente.marca);
  const parentesco = vazioParaUndefined(m.remetente.parentesco);
  const temRemetente = descricao || marca || parentesco || m.remetente.trocouDeNumero;

  const extracao: Extracao = {
    links: limpar(m.links),
    chavesPix: m.chavesPix
      .filter((c) => c.valor.trim() !== "")
      .slice(0, MAX_ITENS)
      .map((c) => {
        const titular = vazioParaUndefined(c.titular);
        return { valor: c.valor.trim(), tipo: c.tipo, ...(titular ? { titular } : {}) };
      }),
    linhasDigitaveis: limpar(m.linhasDigitaveis),
    telefones: m.telefones
      .filter((t) => t.numero.trim() !== "")
      .slice(0, MAX_ITENS)
      .map((t) => ({ numero: t.numero.trim(), contexto: t.contexto })),
    pedeDinheiro: m.pedeDinheiro,
    pedeDadosSensiveis: m.pedeDadosSensiveis,
    urgencia: limpar(m.urgencia).map(cortar),
    trechos: limpar(m.trechos).map(cortar),
    tipoProvavel: m.tipoProvavel,
    tentativaDeManipulacao: m.tentativaDeManipulacao,
  };
  const valor = vazioParaUndefined(m.valor);
  if (valor) extracao.valor = valor;
  if (temRemetente) {
    extracao.remetente = {
      descricao: descricao ?? marca ?? parentesco ?? "não identificado",
      trocouDeNumero: m.remetente.trocouDeNumero,
      ...(parentesco ? { parentesco } : {}),
      ...(marca ? { marca } : {}),
    };
  }
  return extracao;
}

/** Limite de itens por lista: a saída do modelo é cortada, não rejeitada. */
const MAX_ITENS = 20;

function limpar(lista: string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const item of lista) {
    const s = item.trim();
    if (s === "" || vistos.has(s)) continue;
    vistos.add(s);
    saida.push(s);
    if (saida.length >= MAX_ITENS) break;
  }
  return saida;
}

function cortar(s: string): string {
  return s.length <= MAX_TRECHO ? s : s.slice(0, MAX_TRECHO);
}
