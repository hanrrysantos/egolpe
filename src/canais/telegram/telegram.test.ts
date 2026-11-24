import { describe, expect, it, vi } from "vitest";
import type { Veredito } from "@/src/nucleo/tipos";
import type { ApiTelegram } from "./api";
import { classificarMensagem, LIMITE_IMAGEM_BYTES, montarEntrada } from "./converter";
import { escaparHtml, formatarVeredito, tipoDoCallback } from "./formatar";
import { processarUpdate, type DepsProcessar } from "./processar";
import { segredoValido } from "./segredo";
import type { TgMensagem, TgUpdate } from "./tipos";

const chat = { id: 1, type: "private" };
const base = { message_id: 1, chat, from: { id: 1 } };

describe("classificarMensagem", () => {
  it("texto vira analisar", () => {
    expect(classificarMensagem({ ...base, text: "oi mãe, troquei de número" })).toEqual({
      tipo: "analisar",
      texto: "oi mãe, troquei de número",
    });
  });
  it("reconhece /start e /ajuda (com @bot)", () => {
    expect(classificarMensagem({ ...base, text: "/start" })).toEqual({ tipo: "comando", comando: "start" });
    expect(classificarMensagem({ ...base, text: "/ajuda@egolpe_bot" })).toEqual({ tipo: "comando", comando: "ajuda" });
  });
  it("foto: pega o maior que cabe no limite e usa a legenda", () => {
    const c = classificarMensagem({
      ...base,
      caption: "olha isso",
      photo: [
        { file_id: "p", width: 90, height: 90, file_size: 1000 },
        { file_id: "m", width: 800, height: 800, file_size: 90000 },
        { file_id: "g", width: 2000, height: 2000, file_size: LIMITE_IMAGEM_BYTES + 1 },
      ],
    });
    expect(c).toEqual({ tipo: "analisar", texto: "olha isso", imagem: { fileId: "m", mime: "image/jpeg" } });
  });
  it("foto grande demais", () => {
    const c = classificarMensagem({
      ...base,
      photo: [{ file_id: "g", width: 2000, height: 2000, file_size: LIMITE_IMAGEM_BYTES + 1 }],
    });
    expect(c.tipo).toBe("imagem_grande");
  });
  it("documento de imagem é aceito; pdf não", () => {
    expect(
      classificarMensagem({ ...base, document: { file_id: "d", mime_type: "image/png", file_size: 10 } }),
    ).toEqual({ tipo: "analisar", texto: undefined, imagem: { fileId: "d", mime: "image/png" } });
    expect(classificarMensagem({ ...base, document: { file_id: "d", mime_type: "application/pdf" } }).tipo).toBe("outro");
  });
  it("voz, áudio, vídeo e vídeo-nota não são suportados", () => {
    for (const k of ["voice", "audio", "video", "video_note"] as const) {
      expect(classificarMensagem({ ...base, [k]: {} } as TgMensagem).tipo).toBe("midia_nao_suportada");
    }
  });
  it("montarEntrada", () => {
    expect(montarEntrada("oi")).toEqual({ texto: "oi", imagens: [] });
    expect(montarEntrada(undefined, { mime: "image/png", base64: "AA" })).toEqual({
      imagens: [{ mime: "image/png", base64: "AA" }],
    });
  });
});

describe("formatarVeredito", () => {
  const golpe: Veredito = {
    nivel: "golpe",
    tipo: "taxa_entrega",
    motivos: [{ texto: "Pede taxa <b>falsa</b> & urgente", evidencia: "“<script>alert(1)</script> & pague”" }],
    o_que_fazer: ["Não pague.", "Ligue para o banco."],
  };
  it("escapa HTML em motivos e evidências", () => {
    const { texto } = formatarVeredito(golpe);
    expect(texto).not.toContain("<script>");
    expect(texto).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; pague");
    expect(texto).toContain("Pede taxa &lt;b&gt;falsa&lt;/b&gt; &amp; urgente");
  });
  it("mostra nível, passos numerados e botão", () => {
    const { texto, teclado } = formatarVeredito(golpe);
    expect(texto).toContain("🔴");
    expect(texto).toContain("1. Não pague.\n2. Ligue para o banco.");
    expect(teclado?.inline_keyboard[0]?.[0]).toEqual({
      text: "Já paguei / já cliquei",
      callback_data: "depois:taxa_entrega",
    });
  });
  it("seguro sem passos: frase de prudência e sem botão", () => {
    const { texto, teclado } = formatarVeredito({ nivel: "seguro", tipo: "nenhum", motivos: [], o_que_fazer: [] });
    expect(texto).toContain("🟢");
    expect(texto).toContain("na dúvida");
    expect(teclado).toBeUndefined();
  });
  it("respeita o limite de tamanho do Telegram", () => {
    const motivos = Array.from({ length: 40 }, (_, i) => ({ texto: "x".repeat(200), evidencia: `e${i}`.repeat(50) }));
    const { texto } = formatarVeredito({ ...golpe, motivos });
    expect(texto.length).toBeLessThanOrEqual(4096);
    expect(texto).toContain("O que fazer agora");
  });
  it("escaparHtml", () => {
    expect(escaparHtml("a<b>&c")).toBe("a&lt;b&gt;&amp;c");
  });
});

describe("tipoDoCallback", () => {
  it("aceita só tipos conhecidos", () => {
    expect(tipoDoCallback("depois:falso_parente")).toBe("falso_parente");
    expect(tipoDoCallback("depois:inventado")).toBeNull();
    expect(tipoDoCallback("depois:")).toBeNull();
    expect(tipoDoCallback("outro:falso_parente")).toBeNull();
    expect(tipoDoCallback(undefined)).toBeNull();
  });
});

describe("segredoValido", () => {
  it("compara o segredo", () => {
    expect(segredoValido("abc", "abc")).toBe(true);
    expect(segredoValido("abd", "abc")).toBe(false);
    expect(segredoValido("abcd", "abc")).toBe(false);
  });
  it("falha fechada sem cabeçalho ou sem segredo configurado", () => {
    expect(segredoValido(null, "abc")).toBe(false);
    expect(segredoValido("abc", undefined)).toBe(false);
    expect(segredoValido("", "")).toBe(false);
  });
});

function criarDeps(over: Partial<DepsProcessar> = {}) {
  const enviadas: string[] = [];
  const api: ApiTelegram = {
    enviarMensagem: vi.fn(async (_c, html) => {
      enviadas.push(html);
      return 7;
    }),
    editarMensagem: vi.fn(async (_c, _m, html) => {
      enviadas.push(html);
      return true;
    }),
    digitando: vi.fn(async () => undefined),
    responderCallback: vi.fn(async () => undefined),
    baixarArquivo: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
  const analisar = vi.fn(async () => ({ nivel: "suspeito", tipo: "outro", motivos: [], o_que_fazer: ["Espere."] }) as Veredito);
  const limite = vi.fn(async () => ({ permitido: true }));
  const deps: DepsProcessar = { api, analisar, limite, ...over };
  return { deps, api, analisar, limite, enviadas };
}

describe("processarUpdate", () => {
  it("áudio: avisa e não analisa nem consome limite", async () => {
    const t = criarDeps();
    await processarUpdate({ update_id: 1, message: { ...base, voice: {} } }, t.deps);
    expect(t.analisar).not.toHaveBeenCalled();
    expect(t.limite).not.toHaveBeenCalled();
    expect(t.enviadas[0]).toContain("só entendo texto e print");
  });
  it("ignora grupos", async () => {
    const t = criarDeps();
    await processarUpdate({ update_id: 1, message: { ...base, chat: { id: 2, type: "group" }, text: "oi" } }, t.deps);
    expect(t.api.enviarMensagem).not.toHaveBeenCalled();
  });
  it("texto: analisa e edita a mensagem 'Analisando'", async () => {
    const t = criarDeps();
    await processarUpdate({ update_id: 1, message: { ...base, text: "pague agora" } }, t.deps);
    expect(t.analisar).toHaveBeenCalledWith({ texto: "pague agora", imagens: [] });
    expect(t.api.editarMensagem).toHaveBeenCalled();
    expect(t.enviadas.at(-1)).toContain("suspeito");
  });
  it("foto: baixa e manda como base64", async () => {
    const t = criarDeps();
    await processarUpdate(
      { update_id: 1, message: { ...base, photo: [{ file_id: "f", width: 10, height: 10 }] } },
      t.deps,
    );
    expect(t.analisar).toHaveBeenCalledWith({
      imagens: [{ mime: "image/jpeg", base64: Buffer.from([1, 2, 3]).toString("base64") }],
    });
  });
  it("limite estourado: responde orientação básica e não analisa", async () => {
    const t = criarDeps({ limite: async () => ({ permitido: false, motivo: "usuario", voltaEmMinutos: 30 }) });
    await processarUpdate({ update_id: 1, message: { ...base, text: "oi" } }, t.deps);
    expect(t.analisar).not.toHaveBeenCalled();
    expect(t.enviadas[0]).toContain("30 minutos");
    expect(t.enviadas[0]).toContain("verso do seu cartão");
  });
  it("callback válido envia os passos de 'depois'; inválido é ignorado", async () => {
    const t = criarDeps();
    const cb = (data: string): TgUpdate => ({
      update_id: 1,
      callback_query: { id: "c", from: { id: 1 }, data, message: { ...base } },
    });
    await processarUpdate(cb("depois:falso_parente"), t.deps);
    expect(t.api.enviarMensagem).toHaveBeenCalledTimes(1);
    expect(t.limite).not.toHaveBeenCalled();
    await processarUpdate(cb("depois:xx"), t.deps);
    expect(t.api.enviarMensagem).toHaveBeenCalledTimes(1);
    expect(t.api.responderCallback).toHaveBeenCalledTimes(2);
  });
  it("erro na análise: responde orientação básica e não lança", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = criarDeps({
      analisar: async () => {
        throw new Error("conteúdo secreto do usuário");
      },
    });
    await processarUpdate({ update_id: 1, message: { ...base, text: "oi" } }, t.deps);
    expect(t.enviadas.at(-1)).toContain("Não consegui analisar");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secreto");
    spy.mockRestore();
  });
});
