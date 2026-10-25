"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { AlertTriangle, Bell, BellOff, Bike, CheckCircle2, ChefHat, Clock, Flame, GripVertical, Maximize2, Store, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui";
import { beep, minutesSince, timeSP } from "@/lib/beep";
import { dbError } from "@/lib/db-error";
import { browserClient } from "@/lib/supabase/client";
import type { Order, OrderItem, OrderStatus } from "@/lib/types";

/** A cozinha só precisa do que vai no forno: número, tipo, itens e observações. Nada de telefone ou endereço na tela. */
export type Ticket = Pick<Order, "id" | "number" | "status" | "fulfillment" | "notes" | "created_at" | "updated_at"> & {
  order_items: Pick<OrderItem, "id" | "name" | "size_name" | "flavors" | "extras" | "note" | "qty">[];
  /** Cancelado depois de ir para a cozinha: quando e por quê. */
  cancel?: { at: string; note: string | null; from: OrderStatus } | null;
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
const KITCHEN: OrderStatus[] = ["confirmado", "preparo", "pronto"];
/** Para onde a cozinha pode levar um pedido (o banco confere de novo). */
const NEXT: Partial<Record<OrderStatus, OrderStatus[]>> = { confirmado: ["preparo", "pronto"], preparo: ["pronto"] };
const CANCEL_HOURS = 3;

type ItemRow = Ticket["order_items"][number];
type EventRow = { to_status: OrderStatus; from_status: OrderStatus | null; note: string | null; created_at: string };

/** Cozinha pelo painel: pedidos da loja com a sessão da pessoa e aviso na hora pelo Supabase. */
export function PanelKitchen({ pizzeriaId, prepMinutes }: { pizzeriaId: string; prepMinutes: number }) {
  const sb = browserClient();
  const load = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const cancelSince = new Date(Date.now() - CANCEL_HOURS * 3600_000).toISOString();
    const cols = "id,number,status,fulfillment,notes,created_at,updated_at, order_items(id,name,size_name,flavors,extras,note,qty)";
    const [q, c, n] = await Promise.all([
      sb.from("orders").select(cols).eq("pizzeria_id", pizzeriaId).in("status", KITCHEN).gte("created_at", since).order("created_at"),
      sb
        .from("orders")
        .select(`${cols}, order_events(to_status,from_status,note,created_at)`)
        .eq("pizzeria_id", pizzeriaId)
        .eq("status", "cancelado")
        .gte("created_at", since)
        .gte("updated_at", cancelSince)
        .order("created_at"),
      sb.from("orders").select("id", { count: "exact", head: true }).eq("pizzeria_id", pizzeriaId).eq("status", "novo").gte("created_at", since),
    ]);
    if (q.error) return null;
    // Cancelados só entram se já tinham ido para a cozinha (confirmado, no forno ou pronto).
    const cancelled = ((c.data ?? []) as (Ticket & { order_events: EventRow[] })[]).flatMap(({ order_events, ...t }) => {
      const ev = order_events.filter((e) => e.to_status === "cancelado").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return ev && ev.from_status && KITCHEN.includes(ev.from_status) ? [{ ...t, cancel: { at: ev.created_at, note: ev.note, from: ev.from_status } }] : [];
    });
    return { tickets: [...(q.data as Ticket[]), ...cancelled], waiting: n.count ?? 0 };
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

export function KitchenBoard({ source, prepMinutes, title = "Cozinha", actions }: { source: KitchenSource; prepMinutes: number; title?: string; actions?: ReactNode }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [sound, setSound] = useState(false);
  const [dragging, setDragging] = useState<Ticket | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const known = useRef<Map<string, OrderStatus>>(new Map());
  const fetchTickets = source.load;

  const apply = useCallback((r: { tickets: Ticket[]; waiting: number } | null) => {
    if (!r) return;
    setTickets(r.tickets);
    setWaiting(r.waiting);
  }, []);

  // Toca quando chega pedido para preparar e avisa (forte) quando um pedido da cozinha é cancelado.
  const announce = useEffectEvent((r: { tickets: Ticket[] } | null) => {
    if (!r) return;
    const first = known.current.size === 0;
    const fresh = r.tickets.filter((t) => t.status === "confirmado" && !known.current.has(t.id));
    const cancelled = r.tickets.filter((t) => t.status === "cancelado" && known.current.has(t.id) && known.current.get(t.id) !== "cancelado");
    for (const t of r.tickets) known.current.set(t.id, t.status);
    if (first) return;
    if (fresh.length) {
      toast.success(`Novo pedido para preparar: #${fresh.map((t) => t.number).join(", #")}`, { duration: 8000 });
      if (sound && audio.current) beep(audio.current);
    }
    for (const t of cancelled) {
      toast.error(`Pedido #${t.number} CANCELADO: pare o preparo.${t.cancel?.note ? ` Motivo: ${t.cancel.note}` : ""}`, { duration: 15_000 });
      if (sound && audio.current) {
        beep(audio.current);
        setTimeout(() => audio.current && beep(audio.current), 450);
      }
    }
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
    // Já mostra na coluna nova; se o banco recusar, volta.
    setTickets((l) => l?.map((x) => (x.id === t.id ? { ...x, status: to } : x)) ?? l);
    known.current.set(t.id, to);
    const error = await source.move(t.id, to);
    if (error) toast.error(error);
    apply(await fetchTickets());
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

  // Arrastar: mouse a partir de 6 px; no tablet, segurar o cartão por um instante (para não atrapalhar a rolagem).
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }));
  const onDragStart = (e: DragStartEvent) => setDragging((tickets ?? []).find((t) => t.id === e.active.id) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const t = (tickets ?? []).find((x) => x.id === e.active.id);
    const to = e.over?.id as OrderStatus | undefined;
    if (!t || !to || to === t.status) return;
    if (!NEXT[t.status]?.includes(to)) return void toast.error("Na cozinha o pedido só anda para frente: a preparar → no forno → pronto.");
    void move(t, to);
  };

  const list = tickets ?? [];
  const cols: { id: OrderStatus; title: string; icon: typeof Clock; items: Ticket[]; tone: string; drop: boolean }[] = [
    { id: "confirmado", title: "A preparar", icon: Clock, items: list.filter((t) => t.status === "confirmado"), tone: "bg-sand/70", drop: false },
    { id: "preparo", title: "No forno", icon: Flame, items: list.filter((t) => t.status === "preparo"), tone: "bg-dende-soft", drop: true },
    { id: "pronto", title: "Prontos", icon: CheckCircle2, items: list.filter((t) => t.status === "pronto").slice(-12), tone: "bg-success-soft", drop: true },
    {
      id: "cancelado",
      title: "Cancelados",
      icon: XCircle,
      items: list.filter((t) => t.status === "cancelado").sort((a, b) => (b.cancel?.at ?? "").localeCompare(a.cancel?.at ?? "")),
      tone: "bg-tomato-soft/60",
      drop: false,
    },
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
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <p className="mb-2 text-xs text-muted">Dica: segure e arraste o cartão para a próxima coluna, ou use os botões.</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {cols.map((c) => (
              <Column key={c.id} id={c.id} droppable={c.drop} active={!!dragging && !!NEXT[dragging.status]?.includes(c.id)} tone={c.tone}>
                <h2 className="mb-3 flex items-center gap-2 px-1 text-lg font-extrabold">
                  <c.icon className="h-5 w-5" /> {c.title}
                  <span className="ml-auto rounded-full bg-surface px-2.5 text-base">{c.items.length}</span>
                </h2>
                <div className="space-y-3">
                  {c.items.length === 0 ? (
                    <p className="rounded-2xl bg-surface/70 p-6 text-center text-sm text-muted">{c.id === "cancelado" ? `Nenhum nas últimas ${CANCEL_HOURS} h` : "Nenhum pedido"}</p>
                  ) : (
                    c.items.map((t) => <TicketCard key={t.id} t={t} now={now} prepMinutes={prepMinutes} onMove={move} hidden={dragging?.id === t.id} />)
                  )}
                </div>
              </Column>
            ))}
          </div>
          <DragOverlay dropAnimation={null}>{dragging ? <TicketView t={dragging} now={now} prepMinutes={prepMinutes} lifted /> : null}</DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function Column({ id, droppable, active, tone, children }: { id: OrderStatus; droppable: boolean; active: boolean; tone: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !droppable });
  return (
    <section ref={setNodeRef} className={`rounded-[1.5rem] p-3 transition ${tone} ${active ? "outline-2 outline-dashed outline-tomato/60" : ""} ${isOver && active ? "ring-4 ring-tomato" : ""}`}>
      {children}
    </section>
  );
}

function TicketCard({ t, now, prepMinutes, onMove, hidden }: { t: Ticket; now: number; prepMinutes: number; onMove: (t: Ticket, to: OrderStatus) => Promise<void>; hidden: boolean }) {
  const [busy, setBusy] = useState(false);
  const canDrag = !!NEXT[t.status];
  const { setNodeRef, attributes, listeners } = useDraggable({ id: t.id, disabled: !canDrag || busy });
  const go = async (to: OrderStatus) => {
    setBusy(true);
    await onMove(t, to);
    setBusy(false);
  };
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={`${canDrag ? "cursor-grab touch-manipulation select-none active:cursor-grabbing" : ""} ${hidden ? "opacity-30" : ""}`}>
      <TicketView t={t} now={now} prepMinutes={prepMinutes}>
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
      </TicketView>
    </div>
  );
}

/** O cartão em si (também usado como "fantasma" enquanto é arrastado). */
function TicketView({ t, now, prepMinutes, lifted = false, children }: { t: Ticket; now: number; prepMinutes: number; lifted?: boolean; children?: ReactNode }) {
  const mins = minutesSince(t.created_at, now);
  const cancelled = t.status === "cancelado";
  const late = !cancelled && t.status !== "pronto" && mins > prepMinutes;
  return (
    <article
      className={`select-none rounded-2xl bg-surface p-4 shadow-[var(--shadow-soft)] ${late ? "ring-4 ring-tomato" : ""} ${cancelled ? "opacity-80" : ""} ${lifted ? "rotate-2 cursor-grabbing shadow-2xl ring-4 ring-dende" : ""}`}
    >
      <header className="flex items-start justify-between gap-2">
        <p className={`font-brand text-4xl leading-none font-extrabold ${cancelled ? "text-muted line-through" : ""}`}>#{t.number}</p>
        <div className="text-right text-xs">
          <p className="font-bold">
            {timeSP(t.created_at)} · <span className={late ? "text-tomato" : ""}>{mins} min</span>
          </p>
          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-sand px-2 py-0.5 font-bold">
            {t.fulfillment === "entrega" ? <Bike className="h-3 w-3" /> : <Store className="h-3 w-3" />} {t.fulfillment === "entrega" ? "Entrega" : "Retirada"}
          </p>
        </div>
      </header>
      {cancelled && (
        <p className="mt-2 rounded-xl bg-danger px-3 py-2 text-sm font-extrabold text-paper">
          CANCELADO{t.cancel?.at ? ` às ${timeSP(t.cancel.at)}` : ""}: não preparar
          {t.cancel?.note && <span className="block text-xs font-semibold">Motivo: {t.cancel.note}</span>}
        </p>
      )}
      {late && (
        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-tomato px-2 py-0.5 text-[11px] font-extrabold text-paper uppercase">
          <AlertTriangle className="h-3 w-3" /> Atrasado
        </p>
      )}
      <ul className={`mt-3 space-y-2 ${cancelled ? "line-through decoration-2" : ""}`}>
        {t.order_items.map((i: ItemRow) => (
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
      {t.notes && !cancelled && <p className="mt-2 rounded-lg bg-dende-soft px-2 py-1 text-sm font-bold text-warning">Obs. do pedido: {t.notes}</p>}
      {children && <div className="mt-3">{children}</div>}
      {t.status === "pronto" && (
        <p className="mt-3 rounded-xl bg-success-soft p-3 text-center text-sm font-bold text-success">
          Pronto · aguardando {t.fulfillment === "entrega" ? "entregador" : "retirada no balcão"}
        </p>
      )}
      {!!NEXT[t.status] && !lifted && (
        <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-muted">
          <GripVertical className="h-3 w-3" /> segure e arraste
        </p>
      )}
    </article>
  );
}
