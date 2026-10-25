/** Cookie que marca "entrou pelo computador do balcão": guarda o link e os minutos sem uso até sair sozinho. */
export const COUNTER_COOKIE = "pav-balcao";

export type CounterSession = { code: string; idle: number };

export function readCounterCookie(raw: string | undefined): CounterSession | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CounterSession>;
    return typeof v.code === "string" && /^[0-9a-f]{32}$/.test(v.code) && typeof v.idle === "number" ? { code: v.code, idle: v.idle } : null;
  } catch {
    return null;
  }
}
