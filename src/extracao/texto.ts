/**
 * Normalização para comparar citações: minúsculas, sem acentos, aspas tipográficas trocadas,
 * espaços colapsados, sem aspas e pontuação nas pontas.
 */
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[“”«»„]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'.,;:!?…\s-]+|["'.,;:!?…\s-]+$/g, "");
}
