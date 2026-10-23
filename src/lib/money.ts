/** Dinheiro sempre em centavos inteiros. */
export const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "12,50" | "12.50" | "R$ 1.234,56" → centavos. Devolve null se não for um valor válido. */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[R$\s]/g, "");
  if (!s) return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** Centavos → "1.234,56" (formato dos campos de dinheiro). */
export const centsToInput = (cents: number) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
