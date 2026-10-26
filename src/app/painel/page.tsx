import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Banknote, Bike, CheckCircle2, ChefHat, Circle, Clock, Flame, Monitor, Receipt, Timer, TrendingDown, TrendingUp, Wallet, XCircle } from "lucide-react";
import { Panel } from "@/components/ui";
import { AutoRefresh } from "@/app/pedido/[token]/auto-refresh";
import { avgDelivery, avgPrep, change, lateOrders, sales, serverNow, topItems, type DashEvent, type DashItem, type DashOrder } from "@/lib/dashboard";
import { brl } from "@/lib/money";
import { CHANNEL_LABEL, STATUS } from "@/lib/order-labels";
import { createClient } from "@/lib/supabase/server";
import { can, getTenant, startOfTodaySP } from "@/lib/tenant";
import type { Channel } from "@/lib/types";
import { CopyLink } from "./copy-link";

type Row = DashOrder & { number: number; customer_name: string; channel: Channel; courier_id: string | null };
type CancelEvent = { order_id: string; note: string | null; created_at: string };
type CashNow = { opened_at: string; opened_by: string | null; totals: { total_recebido: number } } | null;

const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const WEEK = 7 * 864e5;

export default async function Overview() {
  const t = (await getTenant())!;
  if (t.role === "driver") redirect("/painel/entregador");
  if (t.role === "kitchen") redirect("/painel/cozinha");
  if (t.role === "attendant") redirect("/painel/pedidos");
  if (t.role === "waiter") redirect("/painel/mesas");
  const pz = t.pizzeria;
  // Gerente sem "ver o faturamento" vê a operação, mas não os valores.
  const money = t.role !== "manager" || t.perms.faturamento;
  const hide = (v: string) => (money ? v : "—");
  const sb = await createClient();
  const start = startOfTodaySP();
  const now = serverNow();
  const since = start.toISOString();
  const cols = "id,number,status,total_cents,customer_name,channel,created_at,eta_max,fulfillment,dispatched_at,delivered_at,courier_id";
  const [orders, before, events, payments, cash, couriers, products, prices] = await Promise.all([
    sb.from("orders").select(cols).eq("pizzeria_id", pz.id).gte("created_at", since).order("created_at", { ascending: false }),
    // Mesmo dia da semana passada, até a mesma hora (comparação justa no meio do expediente).
    sb
      .from("orders")
      .select("id,status,total_cents,created_at,eta_max,fulfillment,dispatched_at,delivered_at")
      .eq("pizzeria_id", pz.id)
      .gte("created_at", new Date(start.getTime() - WEEK).toISOString())
      .lte("created_at", new Date(now - WEEK).toISOString()),
    sb.from("order_events").select("order_id,to_status,note,created_at").eq("pizzeria_id", pz.id).gte("created_at", since).in("to_status", ["confirmado", "pronto", "cancelado"]),
    can(t.role, "pdv") ? sb.from("payments").select("kind,amount_cents").eq("pizzeria_id", pz.id).gte("created_at", since) : Promise.resolve({ data: [] }),
    can(t.role, "caixa") ? sb.rpc("cash_current", { _pz: pz.id }) : Promise.resolve({ data: null }),
    sb.from("couriers").select("id,name,active").eq("pizzeria_id", pz.id).eq("active", true).order("name"),
    sb.from("products").select("id,is_pizza").eq("pizzeria_id", pz.id).eq("archived", false),
    sb.from("product_prices").select("product_id").eq("pizzeria_id", pz.id),
  ]);
  const list = (orders.data ?? []) as Row[];
  const ids = list.map((o) => o.id);
  const items = ids.length ? (((await sb.from("order_items").select("order_id,name,size_name,qty").in("order_id", ids)).data ?? []) as DashItem[]) : [];

  const today = sales(list);
  const prev = sales((before.data ?? []) as DashOrder[]);
  const revChange = change(today.revenue, prev.revenue);
  const countChange = change(today.count, prev.count);
  const received = ((payments.data ?? []) as { kind: string; amount_cents: number }[]).reduce((a, p) => a + (p.kind === "recebimento" ? p.amount_cents : -p.amount_cents), 0);
  const ev = (events.data ?? []) as (DashEvent & { note: string | null })[];
  const prep = avgPrep(ev);
  const onStreet = avgDelivery(list);
  const late = lateOrders(list, now, pz.prep_minutes);
  const valid = new Set(list.filter((o) => o.status !== "cancelado" && o.status !== "novo").map((o) => o.id));
  const top = topItems(items, valid);
  const cancels = ev.filter((e) => e.to_status === "cancelado") as CancelEvent[];
  const byId = new Map(list.map((o) => [o.id, o]));
  const count = (s: Row["status"]) => list.filter((o) => o.status === s).length;
  const cashNow = (cash.data ?? null) as CashNow;
  const activeCouriers = (couriers.data ?? []) as { id: string; name: string }[];
  const busyCouriers = new Set(list.filter((o) => o.status === "saiu" && o.courier_id).map((o) => o.courier_id));

  const prods = (products.data ?? []) as { id: string; is_pizza: boolean }[];
  const priced = new Set(((prices.data ?? []) as { product_id: string }[]).map((p) => p.product_id));
  const checklist = [
    { done: prods.length > 0, label: "Cadastrar os produtos do cardápio", href: "/painel/cardapio" },
    // Só aparece para quem vende produto montado por tamanho (pizza, açaí...).
    ...(prods.some((p) => p.is_pizza)
      ? [{ done: prods.filter((p) => p.is_pizza).every((p) => priced.has(p.id)), label: "Dar preço em cada tamanho aos produtos por tamanho", href: "/painel/cardapio" }]
      : []),
    { done: !!pz.phone, label: "Informar telefone e endereço da loja", href: "/painel/configuracoes" },
    { done: Object.keys((pz.opening_hours as object) ?? {}).length > 0, label: "Definir o horário de funcionamento", href: "/painel/configuracoes" },
  ];
  const pending = checklist.filter((c) => !c.done);

  return (
    <>
      <AutoRefresh seconds={30} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Painel do dia · {pz.name}</h1>
          <p className="text-sm text-muted">Números de hoje (horário de Brasília). Atualiza sozinho a cada 30 s.</p>
        </div>
        <CopyLink slug={pz.slug} />
      </div>

      {/* Vendas */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Vendido hoje" value={hide(brl(today.revenue))} icon={Banknote} delta={money ? revChange : null} hint={money && prev.revenue ? `semana passada até agora: ${brl(prev.revenue)}` : "pedidos confirmados"} />
        <Kpi label="Pedidos" value={String(today.count)} icon={Receipt} delta={countChange} hint={`${today.cancelled} cancelado(s)${prev.count ? ` · semana passada: ${prev.count}` : ""}`} />
        <Kpi label="Ticket médio" value={hide(brl(today.avgTicket))} icon={TrendingUp} hint={money && prev.avgTicket ? `semana passada: ${brl(prev.avgTicket)}` : "valor médio por pedido"} />
        <Kpi label="Recebido hoje" value={can(t.role, "pdv") && money ? brl(received) : "—"} icon={Wallet} hint="registrado no caixa, já descontados estornos" />
      </div>

      {/* Operação agora */}
      <Panel
        title="Operação agora"
        className="mt-4"
        action={
          <Link href="/painel/pedidos" className="text-xs font-bold text-tomato">
            Abrir pedidos
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(
            [
              ["Aguardando", count("novo"), Clock, "bg-info-soft text-info"],
              ["A preparar", count("confirmado"), ChefHat, "bg-sand text-ink"],
              ["No forno", count("preparo"), Flame, "bg-dende-soft text-warning"],
              ["Prontos", count("pronto"), CheckCircle2, "bg-success-soft text-success"],
              ["Em rota", count("saiu"), Bike, "bg-tomato-soft text-tomato-deep"],
            ] as const
          ).map(([label, n, Icon, cls]) => (
            <div key={label} className={`rounded-2xl p-3 ${cls}`}>
              <p className="flex items-center gap-1.5 text-xs font-bold">
                <Icon className="h-3.5 w-3.5" /> {label}
              </p>
              <p className="font-brand text-3xl font-extrabold">{n}</p>
            </div>
          ))}
        </div>
        {late.length > 0 && (
          <div className="mt-3 rounded-2xl bg-tomato px-4 py-3 text-paper">
            <p className="flex items-center gap-1.5 text-sm font-extrabold">
              <AlertTriangle className="h-4 w-4" /> {late.length} pedido(s) atrasado(s)
            </p>
            <p className="mt-1 text-xs">
              {late
                .map((o) => `#${(o as Row).number} (${STATUS[o.status].label.toLowerCase()}, ${Math.round((now - new Date(o.created_at).getTime()) / 60_000)} min)`)
                .join(" · ")}
            </p>
          </div>
        )}
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Tempos médios de hoje">
          <ul className="space-y-3 text-sm">
            <li className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <ChefHat className="h-4 w-4 text-muted" /> Preparo (confirmado → pronto)
              </span>
              <b className={prep != null && prep > pz.prep_minutes ? "text-tomato" : ""}>{prep != null ? `${prep} min` : "—"}</b>
            </li>
            <li className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Bike className="h-4 w-4 text-muted" /> Na rua (saiu → entregue)
              </span>
              <b>{onStreet != null ? `${onStreet} min` : "—"}</b>
            </li>
            <li className="flex items-center justify-between text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5" /> Meta de preparo
              </span>
              {pz.prep_minutes} min
            </li>
          </ul>
        </Panel>

        <Panel
          title="Caixa"
          action={
            can(t.role, "caixa") ? (
              <Link href="/painel/caixa" className="text-xs font-bold text-tomato">
                Abrir caixa do dia
              </Link>
            ) : undefined
          }
        >
          {!can(t.role, "caixa") ? (
            <p className="text-sm text-muted">—</p>
          ) : cashNow ? (
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-success">
                Aberto desde {time(cashNow.opened_at)}
                {cashNow.opened_by ? ` por ${cashNow.opened_by}` : ""}
              </p>
              <p>
                Já entrou: <b>{hide(brl(cashNow.totals.total_recebido))}</b>
              </p>
            </div>
          ) : (
            <p className="rounded-xl bg-dende-soft px-3 py-2 text-sm font-semibold text-warning">Caixa fechado. Abra para registrar o dia.</p>
          )}
        </Panel>

        <Panel
          title="Entregadores"
          action={
            <Link href="/painel/entregas" className="text-xs font-bold text-tomato">
              Abrir entregas
            </Link>
          }
        >
          {activeCouriers.length === 0 ? (
            <p className="text-sm text-muted">Nenhum entregador ativo.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {activeCouriers.map((c) => (
                <li key={c.id} className="flex items-center justify-between">
                  <span>{c.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${busyCouriers.has(c.id) ? "bg-tomato-soft text-tomato-deep" : "bg-success-soft text-success"}`}>
                    {busyCouriers.has(c.id) ? "em rota" : "livre"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr_340px]">
        <Panel title="Mais vendidos de hoje">
          {top.length === 0 ? (
            <p className="text-sm text-muted">Ainda sem vendas hoje.</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {top.map(([name, qty], i) => (
                <li key={name} className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-dende text-xs font-extrabold">{i + 1}</span>
                  <span className="flex-1 truncate">{name}</span>
                  <b>{qty}</b>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title={`Cancelamentos de hoje${cancels.length ? ` (${cancels.length})` : ""}`}>
          {cancels.length === 0 ? (
            <p className="text-sm text-muted">Nenhum cancelamento hoje. 👏</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {cancels.map((c) => (
                <li key={c.order_id + c.created_at} className="flex gap-2">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-tomato" />
                  <span>
                    <b>#{byId.get(c.order_id)?.number ?? "?"}</b> · {time(c.created_at)}
                    {money && byId.get(c.order_id) ? ` · ${brl(byId.get(c.order_id)!.total_cents)}` : ""}
                    <span className="block text-xs text-muted">{c.note ?? "sem motivo"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-4">
          {pending.length > 0 && (
            <Panel title="Deixe a loja pronta">
              <ul className="space-y-2 text-sm">
                {checklist.map((c) => (
                  <li key={c.label}>
                    <Link href={c.href} className={`flex items-center gap-2 ${c.done ? "text-muted line-through" : "font-semibold hover:text-tomato"}`}>
                      {c.done ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-tomato" />} {c.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {can(t.role, "pdv") && (
            <Link href="/painel/pdv" className="card flex items-center gap-3 p-5 transition hover:-translate-y-0.5">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-tomato text-paper">
                <Monitor className="h-6 w-6" />
              </span>
              <span>
                <span className="block font-bold">Abrir o PDV</span>
                <span className="text-xs text-muted">Balcão, telefone e WhatsApp</span>
              </span>
            </Link>
          )}
          <Panel title="Últimos pedidos">
            {list.length === 0 ? (
              <p className="text-sm text-muted">Nenhum pedido hoje ainda. Divulgue o link da loja!</p>
            ) : (
              <ul className="divide-y text-sm">
                {list.slice(0, 6).map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate">
                      <b>#{o.number}</b> {o.customer_name}
                      <span className="block text-[11px] text-muted">
                        {time(o.created_at)} · {CHANNEL_LABEL[o.channel]}
                      </span>
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, icon: Icon, hint, delta }: { label: string; value: string; icon: typeof Banknote; hint: string; delta?: number | null }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-muted">{label}</p>
        <Icon className="h-4 w-4 text-tomato" />
      </div>
      <p className="mt-2 flex items-baseline gap-2 font-brand text-2xl font-extrabold">
        {value}
        {delta != null && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${delta >= 0 ? "text-success" : "text-tomato"}`}>
            {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {delta > 0 ? "+" : ""}
            {delta}%
          </span>
        )}
      </p>
      <p className="mt-1 text-[11px] text-muted">{hint}</p>
    </div>
  );
}
