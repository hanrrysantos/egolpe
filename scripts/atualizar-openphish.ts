/**
 * Baixa o feed comunitário do OpenPhish e grava dados/openphish.json (array de URLs).
 * Uso: npx tsx scripts/atualizar-openphish.ts
 * Confira os termos de uso do OpenPhish antes de publicar o resultado.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const FEED = "https://openphish.com/feed.txt";
const DESTINO = fileURLToPath(new URL("../dados/openphish.json", import.meta.url));

const res = await fetch(FEED, { signal: AbortSignal.timeout(30_000) });
if (!res.ok) throw new Error(`OpenPhish respondeu ${res.status}`);
const urls = [
  ...new Set(
    (await res.text())
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//i.test(l)),
  ),
];
await writeFile(DESTINO, JSON.stringify(urls) + "\n", "utf8");
console.log(`${urls.length} URLs gravadas em dados/openphish.json`);
