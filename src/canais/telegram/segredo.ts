import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compara o cabeçalho X-Telegram-Bot-Api-Secret-Token com o segredo esperado em
 * tempo constante. Sem segredo configurado, rejeita tudo (falha fechada).
 */
export function segredoValido(recebido: string | null | undefined, esperado: string | undefined): boolean {
  if (!esperado || !recebido) return false;
  // Hash dos dois lados para ter o mesmo tamanho e não vazar o comprimento.
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}
