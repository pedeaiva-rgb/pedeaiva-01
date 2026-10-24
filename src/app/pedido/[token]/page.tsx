import Link from "next/link";
import type { Metadata } from "next";
import { Bike, Check, Clock, Phone, Receipt, XCircle } from "lucide-react";
import { PavSymbol } from "@/components/brand/logo";
import { SetupNotice } from "@/components/setup-notice";
import { brl } from "@/lib/money";
import { flowFor, PAYMENT_LABEL, PAYMENT_STATUS, STATUS } from "@/lib/order-labels";
import { publicClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";
import type { Fulfillment, OrderStatus, PaymentMethod, PaymentStatus } from "@/lib/types";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = { title: "Acompanhe seu pedido", robots: { index: false } };

type Tracking = {
  number: number;
  status: OrderStatus;
  fulfillment: Fulfillment;
  created_at: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  subtotal_cents: number;
  discount_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  eta_min: number | null;
  eta_max: number | null;
  courier_name?: string | null;
  delivery_code?: string | null;
  pizzeria: { name: string; slug: string; phone: string | null };
  items: { name: string; size_name: string | null; qty: number; subtotal_cents: number; extras: { name: string }[] }[];
  events: { status: OrderStatus; at: string }[];
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export default async function TrackingPage({ params }: PageProps<"/pedido/[token]">) {
  if (!supabaseConfigured) return <SetupNotice />;
  const { token } = await params;
  const valid = /^[0-9a-f-]{36}$/i.test(token);
  const { data } = valid ? await publicClient().rpc("get_order_tracking", { _token: token }) : { data: null };
  const t = data as Tracking | null;

  if (!t) {
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <div className="card max-w-md p-10 text-center">
          <p className="text-xl font-extrabold">Pedido não encontrado</p>
          <p className="mt-1 text-sm text-muted">Use o link recebido ao finalizar o pedido.</p>
        </div>
      </main>
    );
  }

  const steps = flowFor(t.fulfillment);
  const cancelled = t.status === "cancelado";
  const current = steps.indexOf(t.status);
  const at = (s: OrderStatus) => t.events.find((e) => e.status === s)?.at;
  const finished = cancelled || t.status === "entregue";

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      {!finished && <AutoRefresh seconds={15} />}
      <Link href={`/${t.pizzeria.slug}`} className="text-sm font-bold text-tomato">
        ← {t.pizzeria.name}
      </Link>
      <h1 className="mt-2 text-4xl font-extrabold">Pedido #{t.number}</h1>
      <p className="text-sm text-muted">Feito às {time(t.created_at)}</p>

      <div className="mt-4 overflow-hidden rounded-[1.5rem] bg-charcoal text-cream">
        <div className="flex items-center gap-3 p-5">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-tomato">{cancelled ? <XCircle className="h-6 w-6" /> : <Receipt className="h-6 w-6" />}</span>
          <div className="flex-1">
            <p className="text-xs text-cream/70">Situação</p>
            <p className="text-lg font-bold">{t.status === "entregue" && t.fulfillment === "retirada" ? "Retirado" : STATUS[t.status].label}</p>
          </div>
          {t.pizzeria.phone && (
            <a href={`tel:${t.pizzeria.phone}`} aria-label="Ligar para a loja" className="grid h-11 w-11 place-items-center rounded-full bg-paper text-ink">
              <Phone className="h-5 w-5" />
            </a>
          )}
        </div>
        <div className="space-y-2 rounded-t-[1.5rem] bg-surface p-5 text-ink">
          {t.eta_min != null && !finished && (
            <p className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted" /> Previsão: <b>{t.eta_min}–{t.eta_max ?? t.eta_min} min</b>
            </p>
          )}
          {t.fulfillment === "entrega" && t.courier_name && !cancelled && (
            <p className="flex items-center gap-2 text-sm">
              <Bike className="h-4 w-4 text-muted" />
              {t.status === "entregue" ? "Entregue por" : t.status === "saiu" ? "Saiu com" : "Vai entregar:"} <b>{t.courier_name}</b>
            </p>
          )}
          {t.delivery_code && (
            <div className="rounded-2xl bg-dende-soft p-3 text-center">
              <p className="text-xs font-bold text-warning">Código de entrega</p>
              <p className="font-mono text-3xl font-extrabold tracking-[0.4em]">{t.delivery_code}</p>
              <p className="text-xs text-muted">Diga este código ao entregador só quando receber o pedido.</p>
            </div>
          )}
          <p className="text-sm">
            Pagamento: <b>{PAYMENT_LABEL[t.payment_method]}</b> na {t.fulfillment}{" "}
            <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${PAYMENT_STATUS[t.payment_status].cls}`}>{PAYMENT_STATUS[t.payment_status].label}</span>
          </p>
        </div>
      </div>

      {!cancelled && (
        <ol className="card mt-4 p-5">
          {steps.map((s, i) => {
            const done = i < current || (i === current && s === "entregue");
            const now = i === current && s !== "entregue";
            return (
              <li key={s} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span className={`grid h-9 w-9 place-items-center rounded-full ${done ? "bg-tomato text-paper" : now ? "bg-tomato-soft text-tomato ring-2 ring-tomato" : "bg-sand text-muted"}`}>
                    {done ? <Check className="h-4 w-4" /> : <span className="text-xs font-bold">{i + 1}</span>}
                  </span>
                  {i < steps.length - 1 && <span className={`h-7 w-0.5 ${i < current ? "bg-tomato" : "bg-line"}`} />}
                </div>
                <p className={`pt-1.5 text-sm ${now ? "font-bold" : done ? "font-semibold" : "text-muted"}`}>
                  {s === "entregue" && t.fulfillment === "retirada" ? "Retirado" : STATUS[s].label}
                  {at(s) && <span className="ml-2 text-xs font-normal text-muted">{time(at(s)!)}</span>}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      <div className="card mt-4 space-y-2 p-5 text-sm">
        {t.items.map((i, k) => (
          <div key={k} className="flex justify-between gap-3">
            <span>
              {i.qty}× {i.name}
              {i.size_name ? ` (${i.size_name})` : ""}
              {i.extras.length > 0 && <span className="block text-xs text-muted">+ {i.extras.map((e) => e.name).join(", ")}</span>}
            </span>
            <span>{brl(i.subtotal_cents)}</span>
          </div>
        ))}
        <div className="space-y-1 border-t pt-2 text-muted">
          {t.discount_cents > 0 && (
            <div className="flex justify-between">
              <span>Desconto</span>
              <span>− {brl(t.discount_cents)}</span>
            </div>
          )}
          {t.fulfillment === "entrega" && (
            <div className="flex justify-between">
              <span>Entrega</span>
              <span>{brl(t.delivery_fee_cents)}</span>
            </div>
          )}
        </div>
        <div className="flex justify-between border-t pt-2 text-base font-extrabold">
          <span>Total</span>
          <span>{brl(t.total_cents)}</span>
        </div>
      </div>
      <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted">
        <PavSymbol size={18} /> {finished ? "Obrigado pela preferência!" : "Esta página se atualiza sozinha."}
      </p>
    </main>
  );
}
