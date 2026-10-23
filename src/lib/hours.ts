/** Loja aberta/fechada pelo horário de São Paulo. Puro: usado na vitrine e conferido no servidor. */
export const STORE_TZ = "America/Sao_Paulo";
export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

export type Interval = { open: string; close: string };
/** { "0".."6" (0 = domingo): [{ open: "HH:MM", close: "HH:MM" }] }. close <= open atravessa a meia-noite. */
export type OpeningHours = Record<string, Interval[]>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** Mantém só intervalos bem formados; o resto é ignorado (nunca adivinhado). */
export function parseHours(raw: unknown): OpeningHours {
  const out: OpeningHours = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (let d = 0; d < 7; d++) {
    const list = (raw as Record<string, unknown>)[String(d)];
    if (!Array.isArray(list)) continue;
    const ok = list.filter(
      (it): it is Interval =>
        !!it && typeof it.open === "string" && typeof it.close === "string" && HHMM.test(it.open) && HHMM.test(it.close) && it.open !== it.close,
    );
    if (ok.length) out[String(d)] = ok.map(({ open, close }) => ({ open, close }));
  }
  return out;
}

export function spClock(now: Date): { day: number; min: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: STORE_TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")), min: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Janela [abre, fecha): o minuto de abertura conta, o de fechamento não. */
export function isWithinHours(hours: OpeningHours, now: Date): boolean {
  const { day, min } = spClock(now);
  for (const it of hours[String(day)] ?? []) {
    const o = toMin(it.open);
    const c = toMin(it.close);
    if (c > o ? min >= o && min < c : min >= o) return true;
  }
  for (const it of hours[String((day + 6) % 7)] ?? []) {
    const o = toMin(it.open);
    const c = toMin(it.close);
    if (c <= o && min < c) return true; // fim do turno de ontem que passou da meia-noite
  }
  return false;
}

export type StoreStatus = { open: true } | { open: false; reason: "pausada" | "fora_do_horario"; message: string };

export function storeStatus(pz: { accepting_orders: boolean; opening_hours: unknown }, now = new Date()): StoreStatus {
  if (!pz.accepting_orders) return { open: false, reason: "pausada", message: "A loja pausou os pedidos no momento." };
  const hours = parseHours(pz.opening_hours);
  if (Object.keys(hours).length === 0) return { open: true };
  if (!isWithinHours(hours, now)) return { open: false, reason: "fora_do_horario", message: `A loja está fechada agora. ${todayLine(hours, now)}` };
  return { open: true };
}

export function todayLine(hours: OpeningHours, now = new Date()): string {
  const list = hours[String(spClock(now).day)] ?? [];
  return list.length ? `Hoje: ${list.map((i) => `${i.open}–${i.close}`).join(", ")}.` : "Hoje não abrimos.";
}
