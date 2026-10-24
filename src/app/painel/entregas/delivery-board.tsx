"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { Bike, CheckCircle2, HandCoins, MapPin, MessageCircle, Phone, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { Empty, Field, PageHeader, Panel, Spinner, Toggle } from "@/components/ui";
import { MoneyInput } from "@/components/ui/money-input";
import { PhoneInput } from "@/components/ui/phone-input";
import { minutesSince, startOfTodaySP, timeSP } from "@/lib/beep";
import { dbError } from "@/lib/db-error";
import { brl, centsToInput, parseMoney } from "@/lib/money";
import { COURIER_PAY_LABEL, PAYMENT_LABEL, PAYMENT_STATUS, STATUS } from "@/lib/order-labels";
import { formatBrPhone, normalizeBrPhone } from "@/lib/phone";
import { browserClient } from "@/lib/supabase/client";
import type { Courier, CourierPay, Order, OrderItem, Role } from "@/lib/types";
import { MapTab } from "./map-tab";

type Row = Order & { order_items: Pick<OrderItem, "id" | "name" | "size_name" | "qty">[] };
/** Entrega feita e ainda não acertada com o entregador. */
type Open = Pick<Order, "id" | "number" | "courier_id" | "courier_pay_cents" | "courier_cash_cents" | "delivered_at">;
const ASSIGN: Role[] = ["owner", "manager", "cashier", "attendant"];
const DISPATCH: Role[] = ["owner", "manager", "cashier", "attendant", "driver"];
const MANAGE: Role[] = ["owner", "manager"];

const mapsLink = (o: Row) =>
  o.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.address.street}, ${o.address.number} - ${o.address.neighborhood}`)}` : null;

export function DeliveryBoard({ pizzeriaId, role }: { pizzeriaId: string; role: Role }) {
  const sb = browserClient();
  const [tab, setTab] = useState<"fila" | "mapa" | "entregadores" | "acerto">("fila");
  const [open, setOpen] = useState<Open[]>([]);
  const [orders, setOrders] = useState<Row[] | null>(null);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const fetchAll = useCallback(async () => {
    // Em aberto de qualquer dia recente + o que foi entregue hoje.
    const today = startOfTodaySP().toISOString();
    const since = new Date(Date.now() - 2 * 864e5).toISOString();
    const [o, c, s] = await Promise.all([
      sb
        .from("orders")
        .select("*, order_items(id,name,size_name,qty)")
        .eq("pizzeria_id", pizzeriaId)
        .eq("fulfillment", "entrega")
        .gte("created_at", since)
        .or(`status.in.(confirmado,preparo,pronto,saiu),delivered_at.gte.${today}`)
        .order("created_at"),
      sb.from("couriers").select("*").eq("pizzeria_id", pizzeriaId).order("name"),
      sb
        .from("orders")
        .select("id,number,courier_id,courier_pay_cents,courier_cash_cents,delivered_at")
        .eq("pizzeria_id", pizzeriaId)
        .eq("status", "entregue")
        .not("courier_id", "is", null)
        .is("settled_at", null)
        .order("delivered_at"),
    ]);
    if (o.error || c.error) return null;
    // Sem a migração do painel do entregador, o acerto só fica vazio.
    return { orders: o.data as Row[], couriers: c.data as Courier[], open: (s.data ?? []) as Open[] };
  }, [sb, pizzeriaId]);
  const [failed, setFailed] = useState(false);
  const apply = useCallback((r: { orders: Row[]; couriers: Courier[]; open: Open[] } | null) => {
    setFailed(!r);
    if (!r) return;
    setOrders(r.orders);
    setCouriers(r.couriers);
    setOpen(r.open);
  }, []);
  const refresh = async () => apply(await fetchAll());
  const reload = useEffectEvent(async () => apply(await fetchAll()));

  useEffect(() => {
    let alive = true;
    fetchAll().then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [fetchAll, apply]);

  useEffect(() => {
    const ch = sb
      .channel(`entregas-${pizzeriaId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `pizzeria_id=eq.${pizzeriaId}` }, () => void reload())
      .subscribe((s) => setLive(s === "SUBSCRIBED"));
    const poll = setInterval(() => void reload(), 30_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      void sb.removeChannel(ch);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [sb, pizzeriaId]);

  const list = orders ?? [];
  const cols = [
    { title: "Na cozinha", hint: "Ainda sendo preparados", items: list.filter((o) => ["confirmado", "preparo"].includes(o.status)) },
    { title: "Prontos para sair", hint: "Atribua o entregador e marque a saída", items: list.filter((o) => o.status === "pronto") },
    { title: "Em rota", hint: "Saíram para entrega", items: list.filter((o) => o.status === "saiu") },
    { title: "Entregues hoje", hint: "", items: list.filter((o) => o.status === "entregue").reverse() },
  ];

  return (
    <>
      <PageHeader
        title="Entregas"
        subtitle={live ? "Ao vivo: os pedidos de entrega aparecem aqui sozinhos." : "Conectando… atualiza a cada 30 s."}
        actions={
          <div className="flex gap-1 rounded-full bg-sand p-1 text-sm font-bold">
            {(MANAGE.includes(role) ? (["fila", "mapa", "entregadores", "acerto"] as const) : (["fila", "mapa", "entregadores"] as const)).map((k) => (
              <button key={k} onClick={() => setTab(k)} className={`rounded-full px-4 py-1.5 ${tab === k ? "bg-surface shadow-sm" : "text-muted"}`}>
                {{ fila: "Fila de entregas", mapa: "Mapa ao vivo", entregadores: "Entregadores", acerto: "Acerto" }[k]}
              </button>
            ))}
          </div>
        }
      />
      {!orders && failed ? (
        <Panel>
          <p className="text-sm">
            Não foi possível carregar as entregas. Se o sistema acabou de ser atualizado, rode no Supabase o SQL{" "}
            <code className="rounded bg-sand px-1">supabase/migrations/20261023100000_cozinha_entregas.sql</code> e recarregue a página.
          </p>
        </Panel>
      ) : !orders ? (
        <div className="grid place-items-center py-20">
          <Spinner className="h-7 w-7 text-tomato" />
        </div>
      ) : tab === "mapa" ? (
        <MapTab pizzeriaId={pizzeriaId} orders={list} onGeocoded={refresh} />
      ) : tab === "acerto" ? (
        <Settlement couriers={couriers} open={open} onChanged={refresh} />
      ) : tab === "entregadores" ? (
        <Couriers pizzeriaId={pizzeriaId} couriers={couriers} orders={list} canManage={MANAGE.includes(role)} onChanged={refresh} />
      ) : (
        <>
          {couriers.filter((c) => c.active).length === 0 && (
            <p className="mb-4 rounded-2xl bg-dende-soft p-3 text-sm font-semibold text-warning">
              Nenhum entregador ativo. Cadastre em “Entregadores” para atribuir as entregas.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {cols.map((c) => (
              <section key={c.title} className="rounded-[1.5rem] bg-sand/60 p-3">
                <h2 className="flex items-center justify-between px-1 text-base font-extrabold">
                  {c.title} <span className="rounded-full bg-surface px-2.5 text-sm">{c.items.length}</span>
                </h2>
                {c.hint && <p className="mb-2 px-1 text-xs text-muted">{c.hint}</p>}
                <div className="space-y-3">
                  {c.items.length === 0 ? (
                    <Empty>Nenhum pedido.</Empty>
                  ) : (
                    c.items.map((o) => <DeliveryCard key={o.id} o={o} now={now} couriers={couriers} role={role} onChanged={refresh} />)
                  )}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function DeliveryCard({ o, now, couriers, role, onChanged }: { o: Row; now: number; couriers: Courier[]; role: Role; onChanged: () => Promise<void> }) {
  const sb = browserClient();
  const [busy, setBusy] = useState(false);
  const courier = couriers.find((c) => c.id === o.courier_id);
  const late = o.eta_max != null && !["entregue"].includes(o.status) && minutesSince(o.created_at, now) > o.eta_max;
  const run = async (fn: () => PromiseLike<{ error: unknown }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) toast.error(dbError(error));
    else {
      toast.success(ok);
      await onChanged();
    }
  };
  const maps = mapsLink(o);
  const change = o.payment_method === "dinheiro" && o.change_for_cents ? o.change_for_cents - o.total_cents : null;

  return (
    <article className={`rounded-2xl bg-surface p-3 text-sm shadow-[var(--shadow-soft)] ${late ? "ring-2 ring-tomato" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-brand text-2xl leading-none font-extrabold">#{o.number}</p>
          <p className="text-xs text-muted">
            {timeSP(o.created_at)} · há {minutesSince(o.created_at, now)} min
            {o.status === "entregue" && o.delivered_at ? ` · entregue ${timeSP(o.delivered_at)}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {late && <span className="rounded-full bg-tomato px-2 py-0.5 text-[10px] font-bold text-paper">ATRASADO</span>}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
        </div>
      </div>

      <p className="mt-2 font-bold">{o.customer_name}</p>
      {o.customer_phone && (
        <div className="mt-0.5 flex flex-wrap gap-3 text-xs font-bold">
          <a href={`tel:${o.customer_phone}`} className="flex items-center gap-1">
            <Phone className="h-3 w-3" /> {formatBrPhone(o.customer_phone)}
          </a>
          <a href={`https://wa.me/55${o.customer_phone}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-success">
            <MessageCircle className="h-3 w-3" /> WhatsApp
          </a>
        </div>
      )}
      {o.address && (
        <p className="mt-2 flex gap-1 text-xs">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tomato" />
          <span>
            {o.address.street}, {o.address.number}
            {o.address.complement ? ` – ${o.address.complement}` : ""} — <b>{o.address.neighborhood}</b>
            {o.address.reference && <span className="block text-muted">Ref.: {o.address.reference}</span>}
            {maps && (
              <a href={maps} target="_blank" rel="noreferrer" className="block font-bold text-tomato">
                Abrir no mapa
              </a>
            )}
          </span>
        </p>
      )}
      <p className="mt-2 text-xs text-muted">{o.order_items.map((i) => `${i.qty}× ${i.name}${i.size_name ? ` (${i.size_name})` : ""}`).join(", ")}</p>
      {o.notes && <p className="mt-1 rounded-lg bg-dende-soft px-2 py-1 text-xs font-semibold text-warning">Obs.: {o.notes}</p>}
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-bold ${PAYMENT_STATUS[o.payment_status].cls}`}>
          {PAYMENT_LABEL[o.payment_method]} · {PAYMENT_STATUS[o.payment_status].label}
        </span>
        <b className="text-sm">{brl(o.total_cents)}</b>
      </div>
      {change != null && change > 0 && <p className="mt-1 text-xs font-bold text-warning">Levar troco: {brl(change)} (para {brl(o.change_for_cents!)})</p>}

      <div className="mt-3 space-y-2">
        {o.status !== "entregue" && ASSIGN.includes(role) && (
          <select
            aria-label={`Entregador do pedido ${o.number}`}
            className="field !py-2 text-sm"
            disabled={busy}
            value={o.courier_id ?? ""}
            onChange={(e) =>
              run(
                () => sb.rpc("assign_courier", { _order: o.id, _courier: e.target.value || null }),
                e.target.value ? "Entregador atribuído" : "Entregador removido",
              )
            }
          >
            <option value="">{o.courier_id ? "Tirar entregador" : "Escolher entregador…"}</option>
            {couriers
              .filter((c) => c.active || c.id === o.courier_id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? "" : " (desativado)"}
                </option>
              ))}
          </select>
        )}
        {(o.status === "entregue" || !ASSIGN.includes(role)) && courier && (
          <p className="flex items-center gap-1 text-xs font-semibold">
            <Bike className="h-3.5 w-3.5" /> {courier.name}
          </p>
        )}
        {o.status === "pronto" && DISPATCH.includes(role) && (
          <button
            className="btn w-full !py-2.5 text-sm"
            disabled={busy}
            onClick={() => {
              if (!o.courier_id && !confirm("Este pedido está sem entregador. Marcar como saiu mesmo assim?")) return;
              run(() => sb.rpc("transition_order", { _order: o.id, _to: "saiu", _note: null }), `#${o.number} saiu para entrega`);
            }}
          >
            <Send className="h-4 w-4" /> Saiu para entrega
          </button>
        )}
        {o.status === "saiu" && DISPATCH.includes(role) && (
          <button
            className="flex w-full items-center justify-center gap-2 rounded-full bg-success px-4 py-2.5 text-sm font-bold text-paper disabled:opacity-60"
            disabled={busy}
            onClick={() => run(() => sb.rpc("transition_order", { _order: o.id, _to: "entregue", _note: null }), `#${o.number} entregue`)}
          >
            <CheckCircle2 className="h-4 w-4" /> Entregue
          </button>
        )}
      </div>
    </article>
  );
}

function Couriers({ pizzeriaId, couriers, orders, canManage, onChanged }: { pizzeriaId: string; couriers: Courier[]; orders: Row[]; canManage: boolean; onChanged: () => Promise<void> }) {
  const sb = browserClient();
  const [f, setF] = useState({ name: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => PromiseLike<{ error: unknown }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      toast.error(dbError(error));
      return false;
    }
    toast.success(ok);
    await onChanged();
    return true;
  };
  const today = startOfTodaySP().getTime();
  const stats = (id: string) => {
    const done = orders.filter((o) => o.courier_id === id && o.status === "entregue" && o.delivered_at && new Date(o.delivered_at).getTime() >= today);
    return {
      delivered: done.length,
      earned: done.reduce((a, o) => a + (o.courier_pay_cents ?? o.delivery_fee_cents), 0),
      onRoute: orders.filter((o) => o.courier_id === id && o.status === "saiu").length,
    };
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = f.phone ? normalizeBrPhone(f.phone) : null;
    if (f.phone && !phone) return toast.error("Telefone inválido: informe DDD + número");
    const ok = await run(() => sb.from("couriers").insert({ pizzeria_id: pizzeriaId, name: f.name.trim(), phone }), "Entregador cadastrado");
    if (ok) setF({ name: "", phone: "" });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Panel title="Entregadores">
        {couriers.length === 0 ? (
          <Empty>Nenhum entregador cadastrado.</Empty>
        ) : (
          <ul className="divide-y">
            {couriers.map((c) => {
              const s = stats(c.id);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-charcoal text-dende">
                    <Bike className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`font-bold ${c.active ? "" : "text-muted line-through"}`}>{c.name}</p>
                    <p className="text-xs text-muted">{c.phone ? formatBrPhone(c.phone) : "sem telefone"}</p>
                    <p className="text-xs">
                      Hoje: <b>{s.delivered}</b> entrega(s) · ganhou {brl(s.earned)}
                      {s.onRoute > 0 && <span className="text-tomato"> · {s.onRoute} em rota</span>}
                    </p>
                  </div>
                  {canManage && <PayDeal courier={c} onChanged={onChanged} />}
                  {canManage && (
                    <Toggle
                      checked={c.active}
                      label={`${c.name} ativo`}
                      disabled={busy}
                      onChange={(v) => run(() => sb.from("couriers").update({ active: v }).eq("id", c.id), v ? "Entregador ativado" : "Entregador desativado")}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-muted">“Ganhou” segue o combinado de cada entregador (o padrão fica em Configurações → Entregadores). O acerto fica na aba “Acerto”.</p>
      </Panel>
      {canManage && (
        <Panel title="Novo entregador">
          <form onSubmit={add} className="space-y-3">
            <Field label="Nome">
              <input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} required />
            </Field>
            <Field label="Telefone (opcional)">
              <PhoneInput value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
            </Field>
            <button className="btn w-full" disabled={busy || !f.name.trim()}>
              <Plus className="h-4 w-4" /> Cadastrar
            </button>
          </form>
        </Panel>
      )}
    </div>
  );
}

/** Combinado de pagamento de um entregador (vazio = padrão da loja). */
function PayDeal({ courier: c, onChanged }: { courier: Courier; onChanged: () => Promise<void> }) {
  const sb = browserClient();
  const [mode, setMode] = useState<CourierPay | "">(c.pay_mode ?? "");
  const [fixed, setFixed] = useState(centsToInput(c.pay_fixed_cents ?? 0));
  const [busy, setBusy] = useState(false);
  // Sem a migração do painel do entregador, a coluna ainda não existe.
  if (c.pay_mode === undefined) return null;
  const needsValue = mode === "fixo" || mode === "taxa_mais_fixo";
  const dirty = mode !== (c.pay_mode ?? "") || (needsValue && parseMoney(fixed || "0") !== (c.pay_fixed_cents ?? 0));
  const save = async () => {
    const cents = parseMoney(fixed || "0");
    if (cents == null) return toast.error("Valor inválido.");
    setBusy(true);
    const { error } = await sb
      .from("couriers")
      .update({ pay_mode: mode || null, pay_fixed_cents: needsValue ? cents : null })
      .eq("id", c.id);
    setBusy(false);
    if (error) return toast.error(dbError(error));
    toast.success(`Combinado de ${c.name.split(" ")[0]} salvo`);
    await onChanged();
  };
  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <select aria-label={`Pagamento de ${c.name}`} className="field !w-auto !py-1.5 text-xs" value={mode} onChange={(e) => setMode(e.target.value as CourierPay | "")}>
        <option value="">Padrão da loja</option>
        {(Object.keys(COURIER_PAY_LABEL) as CourierPay[]).map((k) => (
          <option key={k} value={k}>
            {COURIER_PAY_LABEL[k]}
          </option>
        ))}
      </select>
      {needsValue && <MoneyInput className="field !w-28 !py-1.5 text-xs" value={fixed} onChange={setFixed} />}
      {dirty && (
        <button className="btn !px-3 !py-1.5 text-xs" disabled={busy} onClick={save}>
          {busy && <Spinner className="h-3 w-3" />} Salvar
        </button>
      )}
    </div>
  );
}

/** Quanto a loja deve a cada entregador e quanto dinheiro de cliente ele tem em mãos. */
function Settlement({ couriers, open, onChanged }: { couriers: Courier[]; open: Open[]; onChanged: () => Promise<void> }) {
  const sb = browserClient();
  const [busy, setBusy] = useState<string | null>(null);
  const rows = couriers
    .map((c) => {
      const mine = open.filter((o) => o.courier_id === c.id);
      const pay = mine.reduce((a, o) => a + (o.courier_pay_cents ?? 0), 0);
      const cash = mine.reduce((a, o) => a + o.courier_cash_cents, 0);
      return { c, mine, pay, cash, balance: pay - cash };
    })
    .filter((r) => r.mine.length > 0);

  const settle = async (c: Courier, balance: number) => {
    const msg = balance >= 0 ? `Confirmar que a loja pagou ${brl(balance)} para ${c.name}?` : `Confirmar que ${c.name} devolveu ${brl(-balance)} para a loja?`;
    if (!confirm(msg)) return;
    setBusy(c.id);
    const { error } = await sb.rpc("settle_courier", { _courier: c.id });
    setBusy(null);
    if (error) return toast.error(dbError(error));
    toast.success(`Acerto de ${c.name.split(" ")[0]} feito`);
    await onChanged();
  };

  return (
    <Panel title="Acerto com os entregadores">
      {rows.length === 0 ? (
        <Empty>Tudo acertado. As entregas novas aparecem aqui até você fazer o acerto.</Empty>
      ) : (
        <ul className="divide-y">
          {rows.map(({ c, mine, pay, cash, balance }) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-bold">{c.name}</p>
                <p className="text-xs text-muted">
                  {mine.length} entrega(s) em aberto (#{mine.map((o) => o.number).join(", #")})
                </p>
                <p className="text-xs">
                  Ganhos {brl(pay)} · dinheiro de clientes com ele {brl(cash)}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${balance >= 0 ? "bg-success-soft text-success" : "bg-dende-soft text-warning"}`}>
                {balance >= 0 ? `Loja paga ${brl(balance)}` : `Ele devolve ${brl(-balance)}`}
              </span>
              <button className="btn !py-2 text-sm" disabled={busy != null} onClick={() => settle(c, balance)}>
                {busy === c.id ? <Spinner className="h-4 w-4" /> : <HandCoins className="h-4 w-4" />} Acertar
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-muted">Dinheiro ou cartão recebido na porta é registrado sozinho quando o entregador marca a entrega.</p>
    </Panel>
  );
}
