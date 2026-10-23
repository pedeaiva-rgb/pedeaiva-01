"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { Bell, BellOff, Bike, MessageCircle, Phone, Printer, Store, X } from "lucide-react";
import { toast } from "sonner";
import { Receipt } from "@/components/receipt";
import { Drawer, Empty, PageHeader, Spinner } from "@/components/ui";
import { dbError } from "@/lib/db-error";
import { brl } from "@/lib/money";
import { ACTION_LABEL, CHANNEL_LABEL, nextStatus, PAYMENT_LABEL, PAYMENT_STATUS, STATUS } from "@/lib/order-labels";
import { formatBrPhone } from "@/lib/phone";
import { browserClient } from "@/lib/supabase/client";
import type { Order, OrderItem, OrderStatus, PaymentMethod, Role } from "@/lib/types";

type Row = Order & { order_items: OrderItem[] };
type Period = "abertos" | "hoje" | "7d";

/** Espelho de public.roles_for_transition (o banco é quem decide). */
const ROLES_FOR: Record<OrderStatus, Role[]> = {
  novo: [],
  confirmado: ["owner", "manager", "cashier"],
  preparo: ["owner", "manager", "cashier", "kitchen"],
  pronto: ["owner", "manager", "cashier", "kitchen"],
  saiu: ["owner", "manager", "cashier", "driver"],
  entregue: ["owner", "manager", "cashier", "driver"],
  cancelado: ["owner", "manager", "cashier"],
};
const CASHIER: Role[] = ["owner", "manager", "cashier"];
const MANAGER: Role[] = ["owner", "manager"];

const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const minutesAgo = (iso: string, now: number) => Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
function startOfTodaySP() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return new Date(`${day}T00:00:00-03:00`);
}

/** Bipe curto pelo alto-falante (o navegador só libera som depois de um clique na página). */
function beep(ctx: AudioContext) {
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

export function OrdersBoard({ pizzeriaId, pizzeriaName, role }: { pizzeriaId: string; pizzeriaName: string; role: Role }) {
  const sb = browserClient();
  const [period, setPeriod] = useState<Period>("abertos");
  const [orders, setOrders] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);

  const fetchOrders = useCallback(async (): Promise<Row[] | null> => {
    let q = sb.from("orders").select("*, order_items(*)").eq("pizzeria_id", pizzeriaId).order("created_at", { ascending: false }).limit(300);
    if (period === "abertos") q = q.not("status", "in", "(entregue,cancelado)").gte("created_at", new Date(Date.now() - 3 * 864e5).toISOString());
    if (period === "hoje") q = q.gte("created_at", startOfTodaySP().toISOString());
    if (period === "7d") q = q.gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString());
    const { data, error } = await q;
    return error ? null : (data as Row[]);
  }, [sb, pizzeriaId, period]);
  const apply = useCallback((rows: Row[] | null) => {
    setFailed(!rows);
    if (rows) setOrders(rows);
  }, []);
  const load = useCallback(async () => apply(await fetchOrders()), [apply, fetchOrders]);

  const onNewOrder = useEffectEvent((n: number) => {
    toast.success(`Novo pedido #${n}`, { duration: 8000 });
    if (sound && audio.current) beep(audio.current);
  });
  const reload = useEffectEvent(() => void load());

  useEffect(() => {
    // Primeira carga e troca de período.
    let alive = true;
    fetchOrders().then((rows) => alive && apply(rows));
    return () => {
      alive = false;
    };
  }, [fetchOrders, apply]);

  useEffect(() => {
    const ch = sb
      .channel(`pedidos-${pizzeriaId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `pizzeria_id=eq.${pizzeriaId}` }, (payload) => {
        if (payload.eventType === "INSERT") onNewOrder((payload.new as Order).number);
        reload();
      })
      .subscribe((s) => setLive(s === "SUBSCRIBED"));
    const poll = setInterval(reload, 30_000); // reserva, se a conexão ao vivo cair
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      void sb.removeChannel(ch);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [sb, pizzeriaId]);

  const toggleSound = () => {
    if (!sound) {
      audio.current ??= new AudioContext();
      void audio.current.resume();
      beep(audio.current);
    }
    setSound(!sound);
  };

  const list = orders ?? [];
  const cols: { title: string; items: Row[] }[] = [
    { title: "Novos", items: list.filter((o) => o.status === "novo") },
    { title: "Em andamento", items: list.filter((o) => ["confirmado", "preparo", "pronto", "saiu"].includes(o.status)) },
    ...(period === "abertos" ? [] : [{ title: "Finalizados", items: list.filter((o) => ["entregue", "cancelado"].includes(o.status)) }]),
  ];
  const selected = list.find((o) => o.id === openId) ?? null;

  return (
    <>
      <PageHeader
        title="Pedidos"
        subtitle={live ? "Ao vivo: pedidos novos aparecem sozinhos." : "Conectando… a lista também se atualiza a cada 30 s."}
        actions={
          <>
            <button onClick={toggleSound} className={sound ? "btn !py-2 text-sm" : "btn-ghost !py-2 text-sm"}>
              {sound ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />} {sound ? "Som ligado" : "Ligar som"}
            </button>
            <select aria-label="Período" className="field !w-auto !py-2" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
              <option value="abertos">Em aberto</option>
              <option value="hoje">Hoje (todos)</option>
              <option value="7d">Últimos 7 dias</option>
            </select>
          </>
        }
      />
      {failed && <p className="mb-4 rounded-2xl bg-tomato-soft p-3 text-sm font-semibold text-tomato-deep">Não foi possível carregar os pedidos. Tentando de novo…</p>}
      {!orders ? (
        <div className="grid place-items-center py-20">
          <Spinner className="h-7 w-7 text-tomato" />
        </div>
      ) : (
        <div className={`grid gap-4 ${cols.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
          {cols.map((c) => (
            <section key={c.title} className="rounded-[1.5rem] bg-sand/60 p-3">
              <h2 className="mb-3 flex items-center justify-between px-1 text-base font-extrabold">
                {c.title} <span className="rounded-full bg-surface px-2.5 text-sm">{c.items.length}</span>
              </h2>
              <div className="space-y-3">
                {c.items.length === 0 ? (
                  <Empty>Nenhum pedido.</Empty>
                ) : (
                  c.items.map((o) => <OrderCard key={o.id} o={o} now={now} onOpen={() => setOpenId(o.id)} />)
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      {selected && <OrderDrawer o={selected} role={role} storeName={pizzeriaName} onClose={() => setOpenId(null)} onChanged={load} />}
    </>
  );
}

function OrderCard({ o, now, onOpen }: { o: Row; now: number; onOpen: () => void }) {
  const mins = minutesAgo(o.created_at, now);
  const late = o.eta_max != null && mins > o.eta_max && !["entregue", "cancelado"].includes(o.status);
  return (
    <button onClick={onOpen} className={`card block w-full p-4 text-left transition hover:-translate-y-0.5 ${o.status === "novo" ? "ring-2 ring-tomato" : late ? "ring-2 ring-dende" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-brand text-3xl leading-none font-extrabold">#{o.number}</p>
        <div className="text-right text-xs">
          <p className="font-bold">
            {time(o.created_at)} · <span className={late ? "text-warning" : ""}>{mins} min</span>
          </p>
          <p className="text-muted">{CHANNEL_LABEL[o.channel]}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold">
        <span className={`rounded-full px-2 py-0.5 ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
        <span className="flex items-center gap-1 rounded-full bg-sand px-2 py-0.5">
          {o.fulfillment === "entrega" ? <Bike className="h-3 w-3" /> : <Store className="h-3 w-3" />} {o.fulfillment === "entrega" ? "Entrega" : "Retirada"}
        </span>
        <span className={`rounded-full px-2 py-0.5 ${PAYMENT_STATUS[o.payment_status].cls}`}>
          {PAYMENT_LABEL[o.payment_method]} · {PAYMENT_STATUS[o.payment_status].label}
        </span>
      </div>
      <p className="mt-2 truncate text-sm font-bold">{o.customer_name}</p>
      <p className="line-clamp-2 text-xs text-muted">{o.order_items.map((i) => `${i.qty}× ${i.name}${i.size_name ? ` (${i.size_name})` : ""}`).join(", ")}</p>
      <p className="mt-2 text-right font-extrabold">{brl(o.total_cents)}</p>
    </button>
  );
}

type Event = { id: string; from_status: OrderStatus | null; to_status: OrderStatus; note: string | null; created_at: string };

function OrderDrawer({ o, role, storeName, onClose, onChanged }: { o: Row; role: Role; storeName: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const sb = browserClient();
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>(o.payment_method);
  const next = nextStatus(o.fulfillment, o.status);
  const a = o.address;

  useEffect(() => {
    let alive = true;
    sb.from("order_events")
      .select("id,from_status,to_status,note,created_at")
      .eq("order_id", o.id)
      .order("created_at")
      .then(({ data }) => alive && setEvents((data ?? []) as Event[]));
    return () => {
      alive = false;
    };
  }, [sb, o.id, o.status, o.payment_status]);

  const act = async (fn: () => PromiseLike<{ error: unknown }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) toast.error(dbError(error));
    else {
      toast.success(ok);
      await onChanged();
    }
    return !error;
  };
  const go = (to: OrderStatus, note?: string) => act(() => sb.rpc("transition_order", { _order: o.id, _to: to, _note: note ?? null }), `Pedido #${o.number}: ${STATUS[to].label}`);
  const wa = o.customer_phone ? `https://wa.me/55${o.customer_phone}` : null;

  return (
    <Drawer title={`Pedido #${o.number}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
          <span className="text-xs text-muted">
            {new Date(o.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })} · {CHANNEL_LABEL[o.channel]}
          </span>
        </div>

        <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-soft)]">
          <p className="font-bold">{o.customer_name}</p>
          {o.customer_phone && (
            <div className="mt-1 flex flex-wrap gap-3 text-xs font-bold">
              <a href={`tel:${o.customer_phone}`} className="flex items-center gap-1 text-ink">
                <Phone className="h-3.5 w-3.5" /> {formatBrPhone(o.customer_phone)}
              </a>
              {wa && (
                <a href={wa} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-success">
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </a>
              )}
            </div>
          )}
          {a ? (
            <p className="mt-2">
              {a.street}, {a.number}
              {a.complement ? ` – ${a.complement}` : ""} — <b>{a.neighborhood}</b>
              {a.reference && <span className="block text-xs text-muted">Referência: {a.reference}</span>}
            </p>
          ) : (
            <p className="mt-2 font-semibold">Retirada no balcão</p>
          )}
        </div>

        <div className="space-y-1.5 rounded-2xl bg-sand/60 p-4">
          {o.order_items.map((i) => (
            <div key={i.id}>
              <div className="flex justify-between gap-2">
                <span className="font-semibold">
                  {i.qty}× {i.name}
                  {i.size_name ? ` (${i.size_name})` : ""}
                </span>
                <span>{brl(i.subtotal_cents)}</span>
              </div>
              {i.extras.length > 0 && <p className="text-xs text-muted">+ {i.extras.map((e) => e.name).join(", ")}</p>}
              {i.note && <p className="text-xs font-semibold text-warning">Obs.: {i.note}</p>}
            </div>
          ))}
          <div className="mt-2 space-y-0.5 border-t pt-2 text-xs text-muted">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{brl(o.subtotal_cents)}</span>
            </div>
            {o.discount_cents > 0 && (
              <div className="flex justify-between">
                <span>Cupom {o.coupon_code}</span>
                <span>− {brl(o.discount_cents)}</span>
              </div>
            )}
            {o.fulfillment === "entrega" && (
              <div className="flex justify-between">
                <span>Entrega {o.zone_name ?? ""}</span>
                <span>{brl(o.delivery_fee_cents)}</span>
              </div>
            )}
          </div>
          <div className="flex justify-between text-base font-extrabold">
            <span>Total</span>
            <span>{brl(o.total_cents)}</span>
          </div>
        </div>
        {o.notes && <p className="rounded-2xl bg-dende-soft p-3 font-semibold text-warning">Observação: {o.notes}</p>}

        {/* Status */}
        {next && o.status !== "cancelado" && ROLES_FOR[next].includes(role) && (
          <button className="btn w-full !py-3" disabled={busy} onClick={() => go(next)}>
            {busy && <Spinner className="h-4 w-4" />} {next === "entregue" && o.fulfillment === "retirada" ? "Cliente retirou" : ACTION_LABEL[next]}
          </button>
        )}
        {o.status === "confirmado" && ROLES_FOR.pronto.includes(role) && (
          <button className="btn-ghost w-full" disabled={busy} onClick={() => go("pronto")}>
            Já está pronto (sem preparo)
          </button>
        )}

        {/* Pagamento */}
        <div className="space-y-2 rounded-2xl border p-4">
          <p className="font-bold">
            Pagamento: {PAYMENT_LABEL[o.payment_method]}{" "}
            <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] ${PAYMENT_STATUS[o.payment_status].cls}`}>{PAYMENT_STATUS[o.payment_status].label}</span>
          </p>
          {o.change_for_cents ? <p className="text-xs text-muted">Troco para {brl(o.change_for_cents)} (levar {brl(o.change_for_cents - o.total_cents)})</p> : null}
          {o.payment_status === "pendente" && o.status !== "cancelado" && CASHIER.includes(role) && (
            <div className="flex gap-2">
              <select aria-label="Forma recebida" className="field !py-2" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {(["pix", "cartao", "dinheiro"] as const).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_LABEL[m]}
                  </option>
                ))}
              </select>
              <button
                className="btn-dark shrink-0 !py-2 text-sm"
                disabled={busy}
                onClick={() => act(() => sb.rpc("register_payment", { _order: o.id, _method: method, _note: null }), `Recebimento de ${brl(o.total_cents)} registrado`)}
              >
                Recebi {brl(o.total_cents)}
              </button>
            </div>
          )}
          {o.payment_status === "recebido" &&
            MANAGER.includes(role) &&
            (refundReason == null ? (
              <button className="text-xs font-bold text-muted hover:text-danger" onClick={() => setRefundReason("")}>
                Estornar pagamento
              </button>
            ) : (
              <div className="space-y-2">
                <input className="field !py-2" placeholder="Motivo do estorno (obrigatório)" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} maxLength={300} />
                <div className="flex gap-2">
                  <button className="btn-ghost flex-1 !py-2" onClick={() => setRefundReason(null)}>
                    Voltar
                  </button>
                  <button
                    className="btn flex-1 !py-2"
                    disabled={busy || refundReason.trim().length < 3}
                    onClick={async () => (await act(() => sb.rpc("refund_payment", { _order: o.id, _reason: refundReason }), "Estorno registrado")) && setRefundReason(null)}
                  >
                    Estornar
                  </button>
                </div>
              </div>
            ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button className="btn-ghost !py-2 text-sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Imprimir
          </button>
          {!["entregue", "cancelado"].includes(o.status) && ROLES_FOR.cancelado.includes(role) && cancelReason == null && (
            <button className="flex items-center gap-1 text-xs font-bold text-danger" onClick={() => setCancelReason("")}>
              <X className="h-3.5 w-3.5" /> Cancelar pedido
            </button>
          )}
        </div>
        {cancelReason != null && (
          <div className="space-y-2 rounded-2xl border border-danger/40 p-4">
            <textarea className="field" rows={2} placeholder="Motivo do cancelamento (obrigatório)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={300} />
            <div className="flex gap-2">
              <button className="btn-ghost flex-1 !py-2" onClick={() => setCancelReason(null)}>
                Voltar
              </button>
              <button className="btn flex-1 !py-2" disabled={busy || cancelReason.trim().length < 3} onClick={async () => (await go("cancelado", cancelReason)) && setCancelReason(null)}>
                Cancelar pedido
              </button>
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 font-bold">Histórico</p>
          {events.map((e) => (
            <p key={e.id} className="text-xs text-muted">
              {time(e.created_at)} — {STATUS[e.to_status].label}
              {e.note ? ` · ${e.note}` : ""}
            </p>
          ))}
        </div>
      </div>
      <div className="hidden print:block">
        <Receipt order={o} items={o.order_items} storeName={storeName} />
      </div>
    </Drawer>
  );
}
