"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { AlertTriangle, Bell, BellOff, Bike, CheckCircle2, ChefHat, Clock, Flame, Maximize2, Store } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui";
import { beep, minutesSince, timeSP } from "@/lib/beep";
import { dbError } from "@/lib/db-error";
import { browserClient } from "@/lib/supabase/client";
import type { Order, OrderItem, OrderStatus } from "@/lib/types";

/** A cozinha só precisa do que vai no forno: número, tipo, itens e observações. Nada de telefone ou endereço na tela. */
export type Ticket = Pick<Order, "id" | "number" | "status" | "fulfillment" | "notes" | "created_at" | "updated_at"> & {
  order_items: Pick<OrderItem, "id" | "name" | "size_name" | "flavors" | "extras" | "note" | "qty">[];
};

/**
 * De onde vêm os pedidos: do painel (login da equipe, ao vivo) ou do link da cozinha (aparelho sem login).
 * `subscribe` avisa de mudanças na hora; sem ele, a tela consulta a cada `pollMs`.
 */
export type KitchenSource = {
  key: string;
  load: () => Promise<{ tickets: Ticket[]; waiting: number } | null>;
  move: (id: string, to: OrderStatus) => Promise<string | null>;
  subscribe?: (onChange: () => void, onLive: (live: boolean) => void) => () => void;
  pollMs: number;
};

const fraction = (f: number) => (f === 0.5 ? "½" : Math.abs(f - 1 / 3) < 0.01 ? "⅓" : f === 0.25 ? "¼" : "");

/** Cozinha pelo painel: pedidos da loja com a sessão da pessoa e aviso na hora pelo Supabase. */
export function PanelKitchen({ pizzeriaId, prepMinutes }: { pizzeriaId: string; prepMinutes: number }) {
  const sb = browserClient();
  const load = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [q, n] = await Promise.all([
      sb
        .from("orders")
        .select("id,number,status,fulfillment,notes,created_at,updated_at, order_items(id,name,size_name,flavors,extras,note,qty)")
        .eq("pizzeria_id", pizzeriaId)
        .in("status", ["confirmado", "preparo", "pronto"])
        .gte("created_at", since)
        .order("created_at"),
      sb.from("orders").select("id", { count: "exact", head: true }).eq("pizzeria_id", pizzeriaId).eq("status", "novo").gte("created_at", since),
    ]);
    if (q.error) return null;
    return { tickets: q.data as Ticket[], waiting: n.count ?? 0 };
  }, [sb, pizzeriaId]);
  const move = useCallback(
    async (id: string, to: OrderStatus) => {
      const { error } = await sb.rpc("transition_order", { _order: id, _to: to, _note: null });
      return error ? dbError(error) : null;
    },
    [sb],
  );
  const subscribe = useCallback(
    (onChange: () => void, onLive: (live: boolean) => void) => {
      const ch = sb
        .channel(`cozinha-${pizzeriaId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `pizzeria_id=eq.${pizzeriaId}` }, onChange)
        .subscribe((s) => onLive(s === "SUBSCRIBED"));
      return () => void sb.removeChannel(ch);
    },
    [sb, pizzeriaId],
  );
  const [source] = useState<KitchenSource>(() => ({ key: pizzeriaId, load, move, subscribe, pollMs: 30_000 }));
  return <KitchenBoard source={source} prepMinutes={prepMinutes} />;
}

export function KitchenBoard({ source, prepMinutes, title = "Cozinha", actions }: { source: KitchenSource; prepMinutes: number; title?: string; actions?: React.ReactNode }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const known = useRef<Set<string>>(new Set());

  const fetchTickets = source.load;

  const apply = useCallback((r: { tickets: Ticket[]; waiting: number } | null) => {
    if (!r) return;
    setTickets(r.tickets);
    setWaiting(r.waiting);
  }, []);

  // Toca quando aparece um pedido novo para preparar (confirmado pelo caixa).
  const announce = useEffectEvent((r: { tickets: Ticket[] } | null) => {
    if (!r) return;
    const fresh = r.tickets.filter((t) => t.status === "confirmado" && !known.current.has(t.id));
    const first = known.current.size === 0;
    for (const t of r.tickets) known.current.add(t.id);
    if (first || fresh.length === 0) return;
    toast.success(`Novo pedido para preparar: #${fresh.map((t) => t.number).join(", #")}`, { duration: 8000 });
    if (sound && audio.current) beep(audio.current);
  });
  const reload = useEffectEvent(async () => {
    const r = await fetchTickets();
    announce(r);
    apply(r);
  });

  useEffect(() => {
    let alive = true;
    fetchTickets().then((r) => {
      if (!alive) return;
      announce(r);
      apply(r);
    });
    return () => {
      alive = false;
    };
  }, [fetchTickets, apply]);

  useEffect(() => {
    const stop = source.subscribe?.(() => void reload(), setLive);
    const poll = setInterval(() => void reload(), source.pollMs);
    const tick = setInterval(() => setNow(Date.now()), 20_000);
    return () => {
      stop?.();
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [source]);

  const move = async (t: Ticket, to: OrderStatus) => {
    const error = await source.move(t.id, to);
    if (error) toast.error(error);
    else apply(await fetchTickets());
  };
  const polled = !source.subscribe;

  const toggleSound = () => {
    if (!sound) {
      audio.current ??= new AudioContext();
      void audio.current.resume();
      beep(audio.current);
    }
    setSound(!sound);
  };

  const list = tickets ?? [];
  const cols: { title: string; icon: typeof Clock; items: Ticket[]; tone: string }[] = [
    { title: "A preparar", icon: Clock, items: list.filter((t) => t.status === "confirmado"), tone: "bg-sand/70" },
    { title: "No forno", icon: Flame, items: list.filter((t) => t.status === "preparo"), tone: "bg-dende-soft" },
    { title: "Prontos", icon: CheckCircle2, items: list.filter((t) => t.status === "pronto").slice(-12), tone: "bg-success-soft" },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold">
          <ChefHat className="h-7 w-7 text-tomato" /> {title}
        </h1>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${live || (polled && tickets) ? "bg-success-soft text-success" : "bg-dende-soft text-warning"}`}>
          {live || (polled && tickets) ? "● Ao vivo" : `Conectando… atualiza a cada ${Math.round(source.pollMs / 1000)} s`}
        </span>
        <span className="text-xs text-muted">Meta de preparo: {prepMinutes} min</span>
        {waiting > 0 && <span className="rounded-full bg-info-soft px-3 py-1 text-xs font-bold text-info">{waiting} aguardando confirmação do caixa</span>}
        <div className="ml-auto flex gap-2">
          <button onClick={toggleSound} className={sound ? "btn !py-2 text-sm" : "btn-ghost !py-2 text-sm"}>
            {sound ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />} {sound ? "Som ligado" : "Ligar som"}
          </button>
          <button className="btn-ghost !py-2 text-sm" onClick={() => document.documentElement.requestFullscreen?.()}>
            <Maximize2 className="h-4 w-4" /> Tela cheia
          </button>
          {actions}
        </div>
      </div>

      {!tickets ? (
        <div className="grid place-items-center py-20">
          <Spinner className="h-7 w-7 text-tomato" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {cols.map((c) => (
            <section key={c.title} className={`rounded-[1.5rem] p-3 ${c.tone}`}>
              <h2 className="mb-3 flex items-center gap-2 px-1 text-lg font-extrabold">
                <c.icon className="h-5 w-5" /> {c.title}
                <span className="ml-auto rounded-full bg-surface px-2.5 text-base">{c.items.length}</span>
              </h2>
              <div className="space-y-3">
                {c.items.length === 0 ? (
                  <p className="rounded-2xl bg-surface/70 p-6 text-center text-sm text-muted">Nenhum pedido</p>
                ) : (
                  c.items.map((t) => <TicketCard key={t.id} t={t} now={now} prepMinutes={prepMinutes} onMove={move} />)
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function TicketCard({ t, now, prepMinutes, onMove }: { t: Ticket; now: number; prepMinutes: number; onMove: (t: Ticket, to: OrderStatus) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const mins = minutesSince(t.created_at, now);
  const late = t.status !== "pronto" && mins > prepMinutes;
  const go = async (to: OrderStatus) => {
    setBusy(true);
    await onMove(t, to);
    setBusy(false);
  };
  return (
    <article className={`rounded-2xl bg-surface p-4 shadow-[var(--shadow-soft)] ${late ? "ring-4 ring-tomato" : ""}`}>
      <header className="flex items-start justify-between gap-2">
        <p className="font-brand text-4xl leading-none font-extrabold">#{t.number}</p>
        <div className="text-right text-xs">
          <p className="font-bold">
            {timeSP(t.created_at)} · <span className={late ? "text-tomato" : ""}>{mins} min</span>
          </p>
          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-sand px-2 py-0.5 font-bold">
            {t.fulfillment === "entrega" ? <Bike className="h-3 w-3" /> : <Store className="h-3 w-3" />} {t.fulfillment === "entrega" ? "Entrega" : "Retirada"}
          </p>
        </div>
      </header>
      {late && (
        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-tomato px-2 py-0.5 text-[11px] font-extrabold text-paper uppercase">
          <AlertTriangle className="h-3 w-3" /> Atrasado
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {t.order_items.map((i) => (
          <li key={i.id} className="border-t pt-2 first:border-0 first:pt-0">
            <p className="text-lg leading-tight font-extrabold">
              {i.qty}× {i.flavors.length > 1 ? "Pizza meio a meio" : i.name}
              {i.size_name && <span className="ml-1.5 rounded-md bg-charcoal px-1.5 py-0.5 align-middle text-xs text-cream">{i.size_name}</span>}
            </p>
            {i.flavors.length > 1 && <p className="text-base font-semibold">{i.flavors.map((f) => `${fraction(f.fraction)} ${f.name}`).join("  +  ")}</p>}
            {i.extras.length > 0 && <p className="text-sm font-bold text-tomato">+ {i.extras.map((e) => e.name).join(", ")}</p>}
            {i.note && <p className="mt-1 rounded-lg bg-dende-soft px-2 py-1 text-sm font-bold text-warning">⚠ {i.note}</p>}
          </li>
        ))}
      </ul>
      {t.notes && <p className="mt-2 rounded-lg bg-dende-soft px-2 py-1 text-sm font-bold text-warning">Obs. do pedido: {t.notes}</p>}
      <div className="mt-3">
        {t.status === "confirmado" && (
          <button disabled={busy} onClick={() => go("preparo")} className="btn w-full !py-4 text-lg">
            {busy ? <Spinner className="h-5 w-5" /> : <Flame className="h-5 w-5" />} Iniciar preparo
          </button>
        )}
        {t.status === "preparo" && (
          <button disabled={busy} onClick={() => go("pronto")} className="flex w-full items-center justify-center gap-2 rounded-full bg-success px-5 py-4 text-lg font-bold text-paper disabled:opacity-60">
            {busy ? <Spinner className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />} Pronto
          </button>
        )}
        {t.status === "pronto" && (
          <p className="rounded-xl bg-success-soft p-3 text-center text-sm font-bold text-success">
            Pronto · aguardando {t.fulfillment === "entrega" ? "entregador" : "retirada no balcão"}
          </p>
        )}
      </div>
    </article>
  );
}
