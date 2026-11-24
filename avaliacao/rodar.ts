/**
 * Roda o conjunto de avaliação direto no núcleo (sem bot, sem limite por usuário).
 *
 *   npm run avaliar -- --modelo claude-haiku-5-5|claude-sonnet-5-5|ambos
 *                      [--ids a,b] [--limite N] [--concorrencia N] [--simulado]
 *
 * Contra a API real isto gasta cota: rode só com autorização. `--simulado` usa etapas falsas.
 */
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analisarDetalhado } from "../src/nucleo/analisar";
import type { CasoDeAvaliacao, Entrada, Imagem, ModeloClaude, TipoMimeImagem } from "../src/nucleo/tipos";
import {
  calcularMetricas,
  formatarMarkdown,
  formatarTabela,
  validarCasos,
  type ResultadoCaso,
} from "./metricas";
import { etapasSimuladas } from "./simulado";

const AQUI = dirname(fileURLToPath(import.meta.url));
const MODELOS: ModeloClaude[] = ["claude-haiku-5-5", "claude-sonnet-5-5"];

try {
  process.loadEnvFile(resolve(AQUI, "..", ".env"));
} catch {
  // sem .env: segue com as variáveis do ambiente
}

interface Args {
  modelos: ModeloClaude[];
  ids?: string[];
  limite?: number;
  concorrencia: number;
  simulado: boolean;
}

function lerArgs(argv: string[]): Args {
  const valores = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const prox = argv[i + 1];
    if (prox !== undefined && !prox.startsWith("--")) {
      valores.set(a.slice(2), prox);
      i++;
    } else flags.add(a.slice(2));
  }
  const m = valores.get("modelo") ?? "ambos";
  if (m !== "ambos" && !MODELOS.includes(m as ModeloClaude)) throw new Error(`--modelo inválido: ${m}`);
  const limite = valores.get("limite");
  const conc = Number(valores.get("concorrencia") ?? 3);
  if (!Number.isInteger(conc) || conc < 1) throw new Error("--concorrencia deve ser um inteiro >= 1");
  if (limite !== undefined && !(Number(limite) >= 1)) throw new Error("--limite deve ser >= 1");
  return {
    modelos: m === "ambos" ? MODELOS : [m as ModeloClaude],
    ids: valores.get("ids")?.split(",").map((s) => s.trim()).filter(Boolean),
    limite: limite === undefined ? undefined : Number(limite),
    concorrencia: conc,
    simulado: flags.has("simulado"),
  };
}

const MIME: Record<string, TipoMimeImagem> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function montarEntrada(caso: CasoDeAvaliacao): Entrada {
  const imagens: Imagem[] = [];
  if (caso.entrada.imagem) {
    const caminho = resolve(AQUI, caso.entrada.imagem);
    const mime = MIME[extname(caminho).toLowerCase()];
    if (!mime) throw new Error(`${caso.id}: tipo de imagem não suportado (${caso.entrada.imagem})`);
    imagens.push({ mime, base64: readFileSync(caminho).toString("base64") });
  }
  return { texto: caso.entrada.texto, imagens };
}

// ---------------------------------------------------------------------------
// Uso de tokens (para estimar custo): intercepta as respostas JSON da API.
// ---------------------------------------------------------------------------

interface Uso {
  entrada: number;
  saida: number;
}

function clienteComContagem(uso: Uso): Anthropic {
  const fetchContado: typeof fetch = async (input, init) => {
    const resp = await fetch(input, init);
    if (resp.headers.get("content-type")?.includes("application/json")) {
      resp
        .clone()
        .json()
        .then((j: { usage?: { input_tokens?: number; output_tokens?: number } }) => {
          uso.entrada += j.usage?.input_tokens ?? 0;
          uso.saida += j.usage?.output_tokens ?? 0;
        })
        .catch(() => {});
    }
    return resp;
  };
  return new Anthropic({ maxRetries: 1, fetch: fetchContado });
}

/** Preço em USD por milhão de tokens, "entrada,saida", pela variável PRECO_HAIKU_5_5 ou PRECO_SONNET_5_5. */
function precoDoModelo(modelo: ModeloClaude): { entrada: number; saida: number } | undefined {
  const bruto = process.env[modelo === "claude-haiku-5-5" ? "PRECO_HAIKU_5_5" : "PRECO_SONNET_5_5"];
  if (!bruto) return undefined;
  const [e, s] = bruto.split(",").map(Number);
  return Number.isFinite(e) && Number.isFinite(s) ? { entrada: e!, saida: s! } : undefined;
}

// ---------------------------------------------------------------------------

async function rodarModelo(
  modelo: ModeloClaude,
  casos: CasoDeAvaliacao[],
  args: Args,
  uso: Uso,
): Promise<ResultadoCaso[]> {
  const resultados: ResultadoCaso[] = new Array(casos.length);
  const cliente = args.simulado ? new Anthropic({ apiKey: "simulado" }) : clienteComContagem(uso);
  let proximo = 0;
  let feitos = 0;

  async function trabalhador() {
    while (true) {
      const i = proximo++;
      if (i >= casos.length) return;
      const caso = casos[i]!;
      let r: ResultadoCaso;
      try {
        const a = await analisarDetalhado(montarEntrada(caso), {
          modelo,
          semLog: true,
          cliente,
          ...(args.simulado ? { etapas: etapasSimuladas } : {}),
        });
        r = {
          id: caso.id,
          categoria: caso.categoria,
          esperado: caso.esperado,
          obtido: { nivel: a.veredito.nivel, tipo: a.veredito.tipo },
          motivos: a.veredito.motivos,
          evidencias: a.evidencias.map((e) => ({ sinal: e.sinal, resultado: e.resultado, descricao: e.descricao })),
          duracaoMs: a.duracaoMs,
          erro: a.erro,
        };
      } catch (e) {
        r = {
          id: caso.id,
          categoria: caso.categoria,
          esperado: caso.esperado,
          obtido: { nivel: "suspeito", tipo: "outro" },
          motivos: [],
          evidencias: [],
          duracaoMs: 0,
          erro: e instanceof Error ? e.message : String(e),
        };
      }
      resultados[i] = r;
      feitos++;
      const marca = r.erro ? "ERRO" : r.obtido.nivel === "seguro" && r.esperado.nivel !== "seguro" ? "FALSO NEGATIVO" : r.obtido.nivel === r.esperado.nivel ? "ok" : "diverge";
      process.stderr.write(`[${modelo}] ${feitos}/${casos.length} ${caso.id}: esperado ${caso.esperado.nivel}, obtido ${r.obtido.nivel} (${marca})\n`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(args.concorrencia, casos.length) }, trabalhador));
  return resultados;
}

async function main() {
  const args = lerArgs(process.argv.slice(2));
  const todos: unknown = JSON.parse(readFileSync(resolve(AQUI, "casos.json"), "utf8"));
  const problemas = validarCasos(todos);
  if (problemas.length > 0) {
    console.error("casos.json inválido:\n- " + problemas.join("\n- "));
    process.exit(1);
  }
  let casos = todos as CasoDeAvaliacao[];
  if (args.ids) {
    const desconhecidos = args.ids.filter((id) => !casos.some((c) => c.id === id));
    if (desconhecidos.length > 0) {
      console.error(`ids inexistentes: ${desconhecidos.join(", ")}`);
      process.exit(1);
    }
    casos = casos.filter((c) => args.ids!.includes(c.id));
  }
  if (args.limite) casos = casos.slice(0, args.limite);

  if (!args.simulado && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY ausente. Configure no .env ou use --simulado.");
    process.exit(1);
  }

  const data = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const pasta = resolve(AQUI, "resultados");
  mkdirSync(pasta, { recursive: true });
  const relatorios: { modelo: string; metricas: ReturnType<typeof calcularMetricas> }[] = [];
  const linhasUso: string[] = [];

  for (const modelo of args.modelos) {
    const rotulo = args.simulado ? `${modelo} (simulado)` : modelo;
    console.error(`\nRodando ${casos.length} casos com ${rotulo} (concorrência ${args.concorrencia})`);
    const uso: Uso = { entrada: 0, saida: 0 };
    const resultados = await rodarModelo(modelo, casos, args, uso);
    const metricas = calcularMetricas(resultados);
    relatorios.push({ modelo: rotulo, metricas });

    console.log("\n" + "=".repeat(60));
    console.log(formatarTabela(rotulo, metricas));
    const porId = new Map(casos.map((c) => [c.id, c]));
    for (const id of metricas.falsosNegativos) {
      const r = resultados.find((x) => x.id === id)!;
      console.log(`  FALSO NEGATIVO ${id}: ${porId.get(id)?.descricao} (esperado ${r.esperado.nivel}, obtido seguro)`);
    }
    const divergentes = metricas.erros.filter((id) => !metricas.falsosNegativos.includes(id));
    if (divergentes.length > 0) {
      console.log("\nOutras divergências de nível:");
      for (const id of divergentes) {
        const r = resultados.find((x) => x.id === id)!;
        console.log(`  ${id}: esperado ${r.esperado.nivel}, obtido ${r.obtido.nivel} (${porId.get(id)?.descricao})`);
      }
    }
    for (const r of resultados.filter((x) => x.erro)) console.log(`  FALHA TÉCNICA ${r.id}: ${r.erro}`);

    if (!args.simulado) {
      const preco = precoDoModelo(modelo);
      const custo = preco ? (uso.entrada * preco.entrada + uso.saida * preco.saida) / 1e6 : undefined;
      const txt = `${modelo}: ${uso.entrada} tokens de entrada, ${uso.saida} de saída` + (custo !== undefined ? `, custo estimado US$ ${custo.toFixed(4)} (US$ ${(custo / Math.max(1, casos.length)).toFixed(5)} por análise)` : " (defina PRECO_HAIKU_5_5 / PRECO_SONNET_5_5 como \"entrada,saida\" em US$ por milhão para estimar o custo)");
      console.log("\n" + txt);
      linhasUso.push(`- ${txt}`);
    }

    const arquivo = resolve(pasta, `${data}-${modelo}${args.simulado ? "-simulado" : ""}.json`);
    writeFileSync(arquivo, JSON.stringify({ data, modelo, simulado: args.simulado, uso: args.simulado ? undefined : uso, metricas, resultados }, null, 2) + "\n");
    console.log(`\nResultados: ${arquivo}`);
  }

  const markdown = formatarMarkdown(relatorios, data.slice(0, 10)) + (linhasUso.length ? "\n\nUso de tokens:\n" + linhasUso.join("\n") : "");
  const arquivoMd = resolve(pasta, `${data}${args.simulado ? "-simulado" : ""}-readme.md`);
  writeFileSync(arquivoMd, markdown + "\n");
  console.log("\n--- Trecho para a seção Avaliação do README ---\n" + markdown + `\n\n(salvo em ${arquivoMd})`);
  if (args.simulado) console.log("\nAtenção: execução simulada (heurística de palavras-chave). Não use estes números no README.");

  if (relatorios.some((r) => r.metricas.falsosNegativos.length > 0)) process.exitCode = 2;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
