"use client";

import { Check, Ticket } from "lucide-react";
import { toast } from "sonner";
import { useStoredCoupon } from "@/lib/cart";
import { brl } from "@/lib/money";
import type { StoreCoupon } from "@/lib/types";

const offLabel = (c: StoreCoupon) => (c.discount_type === "percentual" ? `${Number(c.value)}% OFF` : `${brl(Math.round(Number(c.value) * 100))} OFF`);
const dateBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

/** Cupons em destaque no topo da loja. "Usar" guarda o código e o checkout já aplica. */
export function Promotions({ slug, coupons }: { slug: string; coupons: StoreCoupon[] }) {
  const [stored, setStored] = useStoredCoupon(slug);
  if (coupons.length === 0) return null;
  return (
    <section className="mt-5" aria-label="Promoções">
      <p className="eyebrow">Promoções</p>
      <div className="-mx-4 mt-2 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
        {coupons.map((c) => {
          const on = stored === c.code;
          return (
            <div key={c.code} className="relative w-[260px] shrink-0 snap-start overflow-hidden rounded-[1.5rem] bg-tomato p-4 text-paper shadow-[var(--shadow-lift)]">
              <div className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-dende/40" aria-hidden="true" />
              <p className="relative font-brand text-3xl leading-none font-extrabold">{offLabel(c)}</p>
              <p className="relative mt-1 text-sm text-paper/90">
                {c.description || "Use o cupom ao finalizar"}
                {c.min_order_cents > 0 && <span className="block text-xs text-paper/80">em pedidos a partir de {brl(c.min_order_cents)}</span>}
              </p>
              <div className="relative mt-3 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 rounded-full border border-dashed border-paper/70 px-2.5 py-1 font-mono text-xs font-bold">
                  <Ticket className="h-3.5 w-3.5" /> {c.code}
                </span>
                <button
                  className={`rounded-full px-3 py-1.5 text-xs font-bold ${on ? "bg-paper/20 text-paper" : "bg-paper text-tomato-deep"}`}
                  onClick={() => {
                    setStored(on ? "" : c.code);
                    if (!on) toast.success(`Cupom ${c.code} guardado: ele entra sozinho na finalização.`);
                  }}
                >
                  {on ? (
                    <span className="flex items-center gap-1">
                      <Check className="h-3.5 w-3.5" /> Aplicado
                    </span>
                  ) : (
                    "Usar"
                  )}
                </button>
              </div>
              {c.ends_at && <p className="relative mt-2 text-[11px] text-paper/80">Válido até {dateBR(c.ends_at)}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
