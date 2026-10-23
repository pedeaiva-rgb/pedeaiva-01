/**
 * Telefone brasileiro — espelho de public.normalize_br_phone (o banco decide; aqui é o aviso antecipado).
 * Forma canônica: só dígitos, DDD + número (10 fixo começando em 2–5; 11 celular começando em 9).
 * Aceita máscara, espaços, +55/55 e o 0 de longa distância. Devolve null se for inválido.
 */
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61,
  62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export const PHONE_ERROR = "Telefone inválido: informe DDD + número";

export function normalizeBrPhone(raw: string | null | undefined): string | null {
  if (raw == null || raw.length > 25 || !/^[0-9()+\-.\s]*$/.test(raw)) return null;
  let d = raw.replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  else if ((d.length === 11 || d.length === 12) && d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10 && d.length !== 11) return null;
  if (!DDDS.has(Number(d.slice(0, 2)))) return null;
  if (d.length === 11 && d[2] !== "9") return null;
  if (d.length === 10 && !"2345".includes(d[2]!)) return null;
  return d;
}

/** (71) 99999-0001 / (71) 3456-7890 para exibição. */
export function formatBrPhone(p: string): string {
  if (/^\d{11}$/.test(p)) return `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`;
  if (/^\d{10}$/.test(p)) return `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}`;
  return p;
}
