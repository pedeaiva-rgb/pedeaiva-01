/**
 * Endereço livre da loja → consultas do mais preciso para o mais geral.
 * Ex.: "em frente ao cond. X - R. Boa União - Catu de Abrantes, Camaçari - BA, 42821-798"
 * → "Rua Boa União, Catu de Abrantes, Camaçari, BA", "Catu de Abrantes, Camaçari, BA", "Camaçari, BA".
 * (O mapa gratuito não conhece todas as ruas; o bairro ou a cidade já ajudam a achar os clientes.)
 */
export function addressQueries(raw: string): string[] {
  const expand = (s: string) =>
    s
      .replace(/\bR\.\s*/gi, "Rua ")
      .replace(/\bAv\.\s*/gi, "Avenida ")
      .replace(/\bTv\.\s*/gi, "Travessa ")
      .replace(/\bEstr\.\s*/gi, "Estrada ")
      .replace(/\bP(?:ç|c)a\.\s*/gi, "Praça ")
      .replace(/\s+/g, " ")
      .trim();
  const parts = raw
    .split(/\s+-\s+|,|;/)
    .map((s) => s.trim())
    .filter((s) => s && !/^\d{5}-?\d{3}$/.test(s) && !/^(em frente|pr[oó]x|perto|ao lado|esquina|ref|n[ºo°]?\s*$)/i.test(s))
    .map(expand);
  const out: string[] = [];
  for (let i = 0; i < Math.max(1, parts.length - 1); i++) {
    const q = parts.slice(i).join(", ");
    if (q && !out.includes(q)) out.push(q);
  }
  return out;
}
