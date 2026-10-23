"use client";

/** Bipe curto pelo alto-falante (o navegador só libera som depois de um clique na página). */
export function beep(ctx: AudioContext) {
  for (const [freq, start] of [
    [880, 0],
    [1175, 0.18],
  ] as const) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + start);
    o.stop(ctx.currentTime + start + 0.18);
  }
}

/** Início do dia de hoje em São Paulo (Brasil sem horário de verão: UTC−3). */
export function startOfTodaySP() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return new Date(`${day}T00:00:00-03:00`);
}

export const timeSP = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
export const minutesSince = (iso: string, now: number) => Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
