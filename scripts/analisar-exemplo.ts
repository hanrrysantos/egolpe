/**
 * Roda o núcleo de análise num texto SINTÉTICO, contra a API real (gasta cota).
 * Uso: npx tsx scripts/analisar-exemplo.ts [claude-haiku-5-5|claude-sonnet-5-5] ["texto"]
 * Precisa de ANTHROPIC_API_KEY no .env (ou no ambiente).
 */
import { existsSync } from "node:fs";
import { analisarDetalhado } from "@/src/nucleo/analisar";
import type { ModeloClaude } from "@/src/nucleo/tipos";

if (existsSync(".env")) process.loadEnvFile(".env");

const modelo = (process.argv[2] as ModeloClaude | undefined) ?? "claude-haiku-5-5";
const texto =
  process.argv[3] ??
  "Oi mãe, troquei de número, salva esse. Preciso pagar um boleto hoje e meu app travou. Faz um Pix de R$ 1.850,00 pra chave 1b2c3d4e-0000-4abc-8def-1234567890ab? Te devolvo amanhã.";

const r = await analisarDetalhado({ texto, imagens: [] }, { modelo, semLog: true });
console.log(JSON.stringify({ modelo: r.modelo, duracaoMs: r.duracaoMs, erro: r.erro, extracao: r.extracao, evidencias: r.evidencias, veredito: r.veredito }, null, 2));
