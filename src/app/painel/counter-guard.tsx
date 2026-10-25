"use client";

import { useEffect, useRef, useState } from "react";
import { Monitor } from "lucide-react";
import { switchCounterUser } from "./actions";

/**
 * Modo balcão: faixa no topo com quem está usando e saída automática depois de X minutos sem
 * mexer na tela (o próximo funcionário entra com o próprio PIN).
 */
export function CounterGuard({ idleMinutes, name }: { idleMinutes: number; name: string | null }) {
  const last = useRef(0);
  const [left, setLeft] = useState(idleMinutes * 60);

  useEffect(() => {
    last.current = Date.now();
    const touch = () => (last.current = Date.now());
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    const tick = setInterval(() => {
      const rest = Math.round(idleMinutes * 60 - (Date.now() - last.current) / 1000);
      setLeft(rest);
      if (rest <= 0) void switchCounterUser();
    }, 1000);
    return () => {
      for (const e of events) window.removeEventListener(e, touch);
      clearInterval(tick);
    };
  }, [idleMinutes]);

  const warn = left <= 30;
  return (
    <div className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold ${warn ? "bg-tomato text-paper" : "bg-charcoal text-cream"}`}>
      <Monitor className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">
        Modo balcão · {name ?? "equipe"}
        {warn ? ` · saindo em ${Math.max(0, left)} s sem uso` : ""}
      </span>
      <form action={switchCounterUser}>
        <button className="rounded-full bg-paper/15 px-3 py-0.5 font-bold hover:bg-paper/25">Trocar de pessoa</button>
      </form>
    </div>
  );
}
