"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { Banknote, Bell, BellOff, BellRing, CheckCircle2, Hand, MapPin, MessageCircle, Navigation, Phone, Route, Send, Undo2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Empty, Panel, Spinner } from "@/components/ui";
import { beep, minutesSince, startOfTodaySP, timeSP } from "@/lib/beep";
import { dbError } from "@/lib/db-error";
import { blankNumber } from "@/lib/address-key";
import { googleRouteUrl } from "@/lib/geo";
import { brl } from "@/lib/money";
import { PAYMENT_LABEL } from "@/lib/order-labels";
import { formatBrPhone } from "@/lib/phone";
import { browserClient } from "@/lib/supabase/client";
import type { Courier, Order, OrderItem } from "@/lib/types";
import { LIVE_TRACKING } from "@/lib/features";
import { useNotifications } from "@/lib/use-notifications";
import { LocationPanel } from "./location-panel";
import { askLocation, useCourierGps, useGeoPermission, useWakeLock } from "./use-courier-gps";

type Row = Order & { order_items: Pick<OrderItem, "id" | "name" | "size_name" | "qty">[] };
type Done = Pick<Order, "id" | "number" | "delivered_at" | "delivery_fee_cents" | "courier_pay_cents" | "courier_cash_cents" | "settled_at" | "zone_name"> & {
  address: Order["address"];
};
type Tab = "disponiveis" | "minhas" | "ganhos";

/** Endereço em texto para o Google Maps/Waze, com condomínio e cidade da loja (sem a cidade, ele erra de lugar). */
const addressText = (o: Pick<Order, "address">, city: string | null) =>
  o.address
    ? [`${o.address.street}${blankNumber(o.address.number) ? "" : `, ${o.address.number}`}`, o.address.complement, o.address.neighborhood, city].filter(Boolean).join(", ")
    : "";
/** Com o ponto que o próprio cliente marcou no checkout vai pelas coordenadas; senão, pelo endereço escrito (o Google acha). */
const fromCustomer = (o: Row) => o.geo_status === "ok" && o.dest_lat != null && o.dest_lng != null;
const navTarget = (o: Row, city: string | null) => (fromCustomer(o) ? `${o.dest_lat},${o.dest_lng}` : addressText(o, city));
const googleMaps = (o: Row, city: string | null) => `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(navTarget(o, city))}`;
const waze = (o: Row, city: string | null) =>
  fromCustomer(o) ? `https://waze.com/ul?navigate=yes&ll=${o.dest_lat},${o.dest_lng}` : `https://waze.com/ul?navigate=yes&q=${encodeURIComponent(addressText(o, city))}`;

/** O que o entregador tem que receber na porta. */
function toCollect(o: Order) {
  if (o.payment_status !== "pendente") return { label: `Já pago (${PAYMENT_LABEL[o.payment_method]})`, warn: false };
  if (o.payment_method === "dinheiro") {
    const change = o.change_for_cents && o.change_for_cents > o.total_cents ? o.change_for_cents - o.total_cents : 0;
    return {
      label: `Cobrar ${brl(o.total_cents)} em dinheiro${change ? ` · levar troco de ${brl(change)} (para ${brl(o.change_for_cents!)})` : ""}`,
      warn: true,
    };
  }
  if (o.payment_method === "cartao") return { label: `Cobrar ${brl(o.total_cents)} no cartão (maquininha)`, warn: true };
  return { label: `Pix de ${brl(o.total_cents)} ainda não confirmado: confira com a loja`, warn: true };
}


export function DriverApp({
  pizzeriaId,
  courier,
  selfAssign,
  requireCode,
  city,
}: {
  pizzeriaId: string;
  courier: Courier;
  selfAssign: boolean;
  requireCode: boolean;
  /** Cidade da loja, para o Google Maps não errar de lugar. */
  city: string | null;
}) {
  const sb = browserClient();
  const [tab, setTab] = useState<Tab>("minhas");
  const [orders, setOrders] = useState<Row[] | null>(null);
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const known = useRef<Set<string> | null>(null);
  const { permission: notifyPermission, request, notify } = useNotifications("/painel/entregador");

  const fetchOrders = useCallback(async () => {
    const since = new Date(Date.now() - 2 * 864e5).toISOString();
    // O banco só devolve o que é deste entregador e os prontos sem entregador.
    const { data, error } = await sb
      .from("orders")
      .select("*, order_items(id,name,size_name,qty)")
      .eq("pizzeria_id", pizzeriaId)
      .eq("fulfillment", "entrega")
      .in("status", ["pronto", "saiu"])
      .gte("created_at", since)
      .order("created_at");
    return error ? null : (data as Row[]);
  }, [sb, pizzeriaId]);

  // Avisa (som + vibração) quando aparece pedido novo para pegar ou atribuído pela loja.
  const announce = useEffectEvent((list: Row[] | null) => {
    if (!list) return;
    const relevant = list.filter((o) => o.status === "pronto" && (o.courier_id === courier.id || (selfAssign && !o.courier_id)));
    const first = known.current == null;
    const fresh = relevant.filter((o) => !known.current?.has(o.id));
    known.current = new Set([...(known.current ?? []), ...relevant.map((o) => o.id)]);
    if (first || fresh.length === 0) return;
    const mine = fresh.filter((o) => o.courier_id === courier.id);
    toast.success(mine.length ? `A loja te passou o pedido #${mine.map((o) => o.number).join(", #")}` : `Pedido pronto para sair: #${fresh.map((o) => o.number).join(", #")}`, {
      duration: 8000,
    });
    if (sound && audio.current) beep(audio.current);
    navigator.vibrate?.([200, 100, 200]);
    // Fora da tela (outra aba, Waze na frente): notificação na barra do celular.
    if (document.visibilityState !== "visible") {
      const list = mine.length ? mine : fresh;
      void notify(
        mine.length ? "A loja te passou um pedido" : "Pedido pronto para sair",
        list.map((o) => `#${o.number} · ${o.address?.neighborhood ?? o.customer_name}`).join("\n"),
        `pedido-${list.map((o) => o.id).join("-")}`,
      );
    }
  });
  const reload = useEffectEvent(async () => {
    const r = await fetchOrders();
    announce(r);
    if (r) setOrders(r);
  });

  useEffect(() => {
    let alive = true;
    fetchOrders().then((r) => {
      if (!alive) return;
      announce(r);
      if (r) setOrders(r);
    });
    return () => {
      alive = false;
    };
  }, [fetchOrders]);

  useEffect(() => {
    const ch = sb
      .channel(`entregador-${courier.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `pizzeria_id=eq.${pizzeriaId}` }, () => void reload())
      .subscribe((s) => setLive(s === "SUBSCRIBED"));
    const poll = setInterval(() => void reload(), 20_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      void sb.removeChannel(ch);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [sb, pizzeriaId, courier.id]);

  const toggleSound = () => {
    if (!sound) {
      audio.current ??= new AudioContext();
      void audio.current.resume();
      beep(audio.current);
      navigator.vibrate?.(150);
    }
    setSound(!sound);
  };

  const list = orders ?? [];
  const available = list.filter((o) => !o.courier_id && o.status === "pronto");
  const mine = list.filter((o) => o.courier_id === courier.id);
  const refresh = async () => {
    const r = await fetchOrders();
    if (r) setOrders(r);
  };

  // Em turno ou em rota: GPS ao vivo e tela acesa.
  const [onDuty, setOnDuty] = useState(courier.on_duty ?? false);
  const enRoute = mine.some((o) => o.status === "saiu");
  // Rastreio ao vivo desligado por enquanto (ver lib/features): nada de GPS nem turno.
  const sharing = LIVE_TRACKING && (onDuty || enRoute);
  const { gps, status: gpsStatus } = useCourierGps(pizzeriaId, sharing);
  const permission = useGeoPermission();
  useWakeLock(sharing);
  const toggleDuty = async (on: boolean) => {
    if (on) void askLocation();
    const { error } = await sb.rpc("set_courier_on_duty", { _pz: pizzeriaId, _on: on });
    if (error) return void toast.error(dbError(error));
    setOnDuty(on);
    toast.success(on ? "Turno começado. Deixe esta página aberta." : "Turno encerrado.");
  };
  const askAgain = async () => {
    if (!(await askLocation())) toast.error("A localização não foi liberada. Veja as instruções na tela.");
  };

  // Lembra de não fechar a página durante o turno (o navegador mostra um aviso ao sair).
  useEffect(() => {
    if (!sharing) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [sharing]);

  // Voltou para a página depois de sair dela: lembra de mantê-la aberta.
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    if (!sharing) return;
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > 60_000) {
        toast.warning("Mantenha esta página aberta durante o turno.", { duration: 8_000 });
        hiddenAt.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [sharing]);
  // Várias entregas: uma rota só no Google Maps, na ordem da lista (o Google acha os endereços).
  const routeUrl = mine.length > 1 ? googleRouteUrl(mine.map((o) => navTarget(o, city))) : null;

  const tabs: [Tab, string, number | null][] = [
    ...(selfAssign ? [["disponiveis", "Disponíveis", available.length] as [Tab, string, number]] : []),
    ["minhas", "Minhas entregas", mine.length],
    ["ganhos", "Ganhos", null],
  ];

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Olá, {courier.name.split(" ")[0]}!</h1>
          <p className="text-xs text-muted">{live ? "Ao vivo: os pedidos aparecem aqui sozinhos." : "Conectando… atualiza a cada 20 s."}</p>
        </div>
        <button onClick={toggleSound} className={`btn-ghost !px-3 !py-2 text-xs ${sound ? "!bg-success-soft !text-success" : ""}`}>
          {sound ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />} {sound ? "Som ligado" : "Ligar som"}
        </button>
      </div>

      {notifyPermission === "default" && (
        <div className="card mb-4 flex items-center gap-3 border-2 border-dende p-3 text-xs">
          <BellRing className="h-5 w-5 shrink-0 text-tomato" />
          <span className="flex-1">Ative as notificações para ser avisado de pedido novo mesmo com o Waze ou outra tela aberta.</span>
          <button
            className="btn !px-3 !py-2 text-xs"
            onClick={async () => {
              const p = await request();
              if (p === "granted") void notify("Notificações ligadas", "Você será avisado quando tiver pedido para entregar.", "teste");
              else if (p === "denied") toast.error("Notificações bloqueadas. Dá para liberar no cadeado ao lado do endereço do site.");
            }}
          >
            Ativar
          </button>
        </div>
      )}
      {notifyPermission === "denied" && (
        <p className="mb-4 rounded-xl bg-dende-soft px-3 py-2 text-xs font-semibold text-warning">
          Notificações bloqueadas. Para receber avisos de pedido, toque no cadeado ao lado do endereço do site → Permissões → Notificações → Permitir.
        </p>
      )}

      {LIVE_TRACKING && (
      <div className="mb-4">
        <LocationPanel
          onDuty={onDuty}
          enRoute={enRoute}
          status={gpsStatus}
          permission={permission}
          gps={gps}
          onToggle={toggleDuty}
          onAsk={askAgain}
        />
      </div>
      )}

      <div className="mb-4 flex gap-1 rounded-full bg-sand p-1 text-sm font-bold">
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-full px-3 py-2 ${tab === k ? "bg-surface shadow-sm" : "text-muted"}`}>
            {label}
            {n ? <span className="ml-1 rounded-full bg-tomato px-1.5 text-[11px] text-paper">{n}</span> : null}
          </button>
        ))}
      </div>

      {tab === "ganhos" ? (
        <Earnings pizzeriaId={pizzeriaId} courierId={courier.id} />
      ) : !orders ? (
        <div className="grid place-items-center py-16">
          <Spinner className="h-7 w-7 text-tomato" />
        </div>
      ) : tab === "disponiveis" ? (
        <div className="space-y-3">
          {available.length === 0 ? (
            <Empty>Nenhum pedido pronto esperando entregador agora.</Empty>
          ) : (
            available.map((o) => <AvailableCard key={o.id} o={o} now={now} onChanged={refresh} onTaken={() => setTab("minhas")} />)
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {routeUrl && (
            <a href={routeUrl} target="_blank" rel="noreferrer" className="btn-dark w-full !py-2.5 text-sm">
              <Route className="h-4 w-4" /> Rota completa no Google Maps ({mine.length} paradas)
            </a>
          )}
          {mine.length === 0 ? (
            <Empty>{selfAssign ? "Você não tem entregas agora. Veja os pedidos em “Disponíveis”." : "Você não tem entregas agora. A loja vai te passar os pedidos."}</Empty>
          ) : (
            mine.map((o) => <MyCard key={o.id} o={o} now={now} city={city} requireCode={requireCode} onChanged={refresh} />)
          )}
        </div>
      )}
    </div>
  );
}

function useRun(onChanged: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => PromiseLike<{ error: unknown }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      toast.error(dbError(error));
      await onChanged();
      return false;
    }
    toast.success(ok);
    await onChanged();
    return true;
  };
  return { busy, run };
}

function AvailableCard({ o, now, onChanged, onTaken }: { o: Row; now: number; onChanged: () => Promise<void>; onTaken: () => void }) {
  const sb = browserClient();
  const { busy, run } = useRun(onChanged);
  const pay = toCollect(o);
  return (
    <article className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-brand text-3xl leading-none font-extrabold">#{o.number}</p>
          <p className="text-xs text-muted">pedido às {timeSP(o.created_at)} · há {minutesSince(o.created_at, now)} min</p>
        </div>
        <b className="text-lg">{brl(o.total_cents)}</b>
      </div>
      <p className="mt-2 flex items-center gap-1 font-bold">
        <MapPin className="h-4 w-4 text-tomato" /> {o.address?.neighborhood ?? o.zone_name ?? "—"}
      </p>
      <p className="mt-1 text-xs text-muted">{o.order_items.reduce((a, i) => a + i.qty, 0)} item(ns) · taxa de entrega {brl(o.delivery_fee_cents)}</p>
      <p className={`mt-1 text-xs font-semibold ${pay.warn ? "text-warning" : "text-success"}`}>{pay.label}</p>
      <button
        className="btn mt-3 w-full !py-3"
        disabled={busy}
        onClick={async () => {
          if (await run(() => sb.rpc("take_order", { _order: o.id }), `Pedido #${o.number} é seu`)) onTaken();
        }}
      >
        {busy ? <Spinner className="h-4 w-4" /> : <Hand className="h-4 w-4" />} Pegar este pedido
      </button>
    </article>
  );
}

function MyCard({
  o,
  now,
  city,
  requireCode,
  onChanged,
}: {
  o: Row;
  now: number;
  city: string | null;
  requireCode: boolean;
  onChanged: () => Promise<void>;
}) {
  const sb = browserClient();
  const { busy, run } = useRun(onChanged);
  const [code, setCode] = useState("");
  const pay = toCollect(o);
  const late = o.eta_max != null && minutesSince(o.created_at, now) > o.eta_max;

  return (
    <article className={`card p-4 ${late ? "ring-2 ring-tomato" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-brand text-3xl leading-none font-extrabold">#{o.number}</p>
          <p className="text-xs text-muted">
            {o.status === "saiu" && o.dispatched_at ? `saiu às ${timeSP(o.dispatched_at)}` : "pronto na loja"} · pedido há {minutesSince(o.created_at, now)} min
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${o.status === "saiu" ? "bg-tomato-soft text-tomato-deep" : "bg-success-soft text-success"}`}>
          {o.status === "saiu" ? "Em rota" : "Pegar na loja"}
        </span>
      </div>

      <p className="mt-3 text-lg font-bold">{o.customer_name}</p>
      {o.customer_phone && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <a href={`tel:${o.customer_phone}`} className="btn-ghost !py-2.5 text-sm">
            <Phone className="h-4 w-4" /> Ligar
          </a>
          <a href={`https://wa.me/55${o.customer_phone}`} target="_blank" rel="noreferrer" className="btn-ghost !py-2.5 text-sm !text-success">
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </a>
        </div>
      )}
      {o.customer_phone && <p className="mt-1 text-center text-xs text-muted">{formatBrPhone(o.customer_phone)}</p>}

      {o.address && (
        <div className="mt-3 rounded-2xl bg-sand/60 p-3 text-sm">
          <p className="flex gap-1.5">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-tomato" />
            <span>
              <b>
                {o.address.street}, {o.address.number}
              </b>
              {o.address.complement ? ` – ${o.address.complement}` : ""}
              <span className="block">{o.address.neighborhood}</span>
              {o.address.reference && <span className="block text-xs text-muted">Referência: {o.address.reference}</span>}
            </span>
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <a href={googleMaps(o, city)} target="_blank" rel="noreferrer" className="btn-dark !py-2 text-xs">
              <Navigation className="h-4 w-4" /> Google Maps
            </a>
            <a href={waze(o, city)} target="_blank" rel="noreferrer" className="btn-dark !py-2 text-xs">
              <Navigation className="h-4 w-4" /> Waze
            </a>
          </div>
        </div>
      )}

      <p className={`mt-3 flex gap-1.5 rounded-xl px-3 py-2 text-sm font-bold ${pay.warn ? "bg-dende-soft text-warning" : "bg-success-soft text-success"}`}>
        <Banknote className="h-4 w-4 shrink-0" /> {pay.label}
      </p>
      <p className="mt-2 text-xs text-muted">{o.order_items.map((i) => `${i.qty}× ${i.name}${i.size_name ? ` (${i.size_name})` : ""}`).join(", ")}</p>
      {o.notes && <p className="mt-1 rounded-lg bg-dende-soft px-2 py-1 text-xs font-semibold text-warning">Obs.: {o.notes}</p>}

      <div className="mt-4 space-y-2">
        {o.status === "pronto" && (
          <>
            <button className="btn w-full !py-3" disabled={busy} onClick={() => run(() => sb.rpc("transition_order", { _order: o.id, _to: "saiu", _note: null }), "Boa entrega! 🛵")}>
              <Send className="h-4 w-4" /> Saí para entrega
            </button>
            <button
              className="w-full text-center text-xs font-semibold text-muted hover:text-danger"
              disabled={busy}
              onClick={() => confirm(`Devolver o pedido #${o.number}? Ele volta para a lista de disponíveis.`) && run(() => sb.rpc("release_order", { _order: o.id }), "Pedido devolvido")}
            >
              <Undo2 className="mr-1 inline h-3 w-3" /> Não vou levar este pedido
            </button>
          </>
        )}
        {o.status === "saiu" && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (requireCode && !/^\d{4}$/.test(code)) return void toast.error("Peça ao cliente o código de 4 números.");
              run(() => sb.rpc("complete_delivery", { _order: o.id, _code: code }), `Pedido #${o.number} entregue ✔`);
            }}
          >
            {requireCode && (
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-muted">Código de entrega (o cliente recebeu no WhatsApp e no acompanhamento)</span>
                <input
                  className="field text-center font-mono text-2xl tracking-[0.5em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={4}
                  placeholder="0000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                />
              </label>
            )}
            <button className="flex w-full items-center justify-center gap-2 rounded-full bg-success px-4 py-3 font-bold text-paper disabled:opacity-60" disabled={busy}>
              {busy ? <Spinner className="h-4 w-4" /> : <CheckCircle2 className="h-5 w-5" />} Entreguei
            </button>
          </form>
        )}
      </div>
    </article>
  );
}

const PERIODS = [
  ["hoje", "Hoje"],
  ["7", "7 dias"],
  ["30", "30 dias"],
] as const;

function Earnings({ pizzeriaId, courierId }: { pizzeriaId: string; courierId: string }) {
  const sb = browserClient();
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>("hoje");
  const [data, setData] = useState<{ done: Done[]; open: Done[] } | null>(null);

  useEffect(() => {
    let alive = true;
    const from = period === "hoje" ? startOfTodaySP() : new Date(startOfTodaySP().getTime() - (Number(period) - 1) * 864e5);
    const cols = "id,number,delivered_at,delivery_fee_cents,courier_pay_cents,courier_cash_cents,settled_at,zone_name,address";
    Promise.all([
      sb.from("orders").select(cols).eq("pizzeria_id", pizzeriaId).eq("courier_id", courierId).eq("status", "entregue").gte("delivered_at", from.toISOString()).order("delivered_at", { ascending: false }),
      sb.from("orders").select(cols).eq("pizzeria_id", pizzeriaId).eq("courier_id", courierId).eq("status", "entregue").is("settled_at", null),
    ]).then(([a, b]) => alive && setData({ done: (a.data ?? []) as Done[], open: (b.data ?? []) as Done[] }));
    return () => {
      alive = false;
    };
  }, [sb, pizzeriaId, courierId, period]);

  const sum = (l: Done[], k: "courier_pay_cents" | "courier_cash_cents") => l.reduce((a, o) => a + (o[k] ?? 0), 0);
  const balance = data ? sum(data.open, "courier_pay_cents") - sum(data.open, "courier_cash_cents") : 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-full bg-sand p-1 text-xs font-bold">
        {PERIODS.map(([k, label]) => (
          <button key={k} onClick={() => setPeriod(k)} className={`flex-1 rounded-full px-3 py-1.5 ${period === k ? "bg-surface shadow-sm" : "text-muted"}`}>
            {label}
          </button>
        ))}
      </div>
      {!data ? (
        <div className="grid place-items-center py-10">
          <Spinner className="h-6 w-6 text-tomato" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="card p-4">
              <p className="text-xs font-bold text-muted">Entregas</p>
              <p className="font-brand text-3xl font-extrabold">{data.done.length}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs font-bold text-muted">Você ganhou</p>
              <p className="font-brand text-3xl font-extrabold text-success">{brl(sum(data.done, "courier_pay_cents"))}</p>
            </div>
          </div>
          <Panel title="Acerto com a loja (em aberto)">
            <div className="space-y-1 text-sm">
              <p className="flex justify-between">
                <span>Seus ganhos ainda não acertados</span> <b>{brl(sum(data.open, "courier_pay_cents"))}</b>
              </p>
              <p className="flex justify-between">
                <span>Dinheiro dos clientes com você</span> <b>{brl(sum(data.open, "courier_cash_cents"))}</b>
              </p>
              <p className={`mt-2 flex items-center gap-1.5 rounded-xl px-3 py-2 font-bold ${balance >= 0 ? "bg-success-soft text-success" : "bg-dende-soft text-warning"}`}>
                <Wallet className="h-4 w-4" />
                {balance >= 0 ? `A loja te paga ${brl(balance)}` : `Você devolve ${brl(-balance)} para a loja`}
              </p>
            </div>
          </Panel>
          <Panel title="Entregas do período">
            {data.done.length === 0 ? (
              <Empty>Nenhuma entrega no período.</Empty>
            ) : (
              <ul className="divide-y text-sm">
                {data.done.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      <b>#{o.number}</b> · {o.address?.neighborhood ?? o.zone_name ?? "—"}
                      <span className="block text-xs text-muted">
                        {o.delivered_at ? new Date(o.delivered_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}
                        {o.courier_cash_cents ? ` · recebeu ${brl(o.courier_cash_cents)} em dinheiro` : ""}
                        {o.settled_at ? " · acertado" : ""}
                      </span>
                    </span>
                    <b className="text-success">{brl(o.courier_pay_cents ?? 0)}</b>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
