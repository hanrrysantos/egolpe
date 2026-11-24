import type { MetadadosAnalise } from "./tipos";

/**
 * Único ponto de log do núcleo. Recebe só metadados (duração, nível, tipo, erro):
 * nunca passe conteúdo do usuário para cá.
 */
export function registrarAnalise(meta: MetadadosAnalise): void {
  console.log(JSON.stringify({ evento: "analise", ...meta }));
}

/** Converte um erro em texto seguro para log: só nome/classe, sem mensagem (que pode ecoar conteúdo). */
export function descreverErro(erro: unknown): string {
  if (erro instanceof Error) return erro.name || "Error";
  return typeof erro;
}
