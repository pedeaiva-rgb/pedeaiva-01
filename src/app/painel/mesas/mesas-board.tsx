"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { ArrowRightLeft, Ban, Check, ChefHat, Clock, KeyRound, Plus, Printer, Settings2, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Drawer, Empty, PageHeader, Spinner } from "@/components/ui";
import { MoneyInput } from "@/components/ui/money-input";
import { minutesSince, timeSP } from "@/lib/beep";
import { dbError } from "@/lib/db-error";
import { brl, centsToInput, parseMoney } from "@/lib/money";
import { PAYMENT_LABEL, STATUS } from "@/lib/order-labels";
import { browserClient } from "@/lib/supabase/client";
import type { Menu, Order, OrderItem, PaymentMethod, Role } from "@/lib/types";
import { RoundPicker } from "./round-picker";
import { TablesManager } from "./tables-manager";

export type DiningTable = { id: string; name: string; area: string; active: boolean; sort: number; seats: number | null };
const seatsLabel = (n: number) => `${n} lugar${n === 1 ? "" : "es"}`;
type Tab = { id: string; table_id: string; guests: number | null; service_fee_pct: number; service_note: string | null; opened_at: string };
type Round = Order & { order_items: OrderItem[] };
type Pay = { id: string; tab_id: string; kind: "recebimento" | "estorno"; method: PaymentMethod; amount_cents: number; change_cents: number | null; created_at: string };
type Totals = { subtotal: number; service: number; total: number; paid: number; remaining: number };

/** Mesma conta de public.tab_totals (o banco confere de novo ao receber e fechar). */
function totalsOf(tab: Tab, rounds: Round[], pays: Pay[]): Totals {
  const subtotal = rounds.filter((r) => r.status !== "cancelado").reduce((s, r) => s + r.total_cents, 0);
  const service = Math.round((subtotal * Number(tab.service_fee_pct)) / 100);
  const paid = pays.reduce((s, p) => s + (p.kind === "recebimento" ? p.amount_cents : -p.amount_cents), 0);
  return { subtotal, service, total: subtotal + service, paid, remaining: subtotal + service - paid };
}
const byName = (a: DiningTable, b: DiningTable) => a.sort - b.sort || a.name.localeCompare(b.name, "pt-BR", { numeric: true });
const RECEIVERS: Role[] = ["owner", "manager", "cashier"];

export function MesasBoard({
  pizzeriaId,
  pizzeriaName,
  menu,
  role,
  canManage,
  defaultFee,
}: {
  pizzeriaId: string;
  pizzeriaName: string;
  menu: Menu;
  role: Role;
  canManage: boolean;
  defaultFee: number;
}) {
  const sb = browserClient();
  const [tables, setTables] = useState<DiningTable[] | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [failed, setFailed] = useState(false);
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** Grupo da fila de espera: destaca as mesas livres onde ele cabe. */
  const [group, setGroup] = useState("");

  const fetchAll = useCallback(async () => {
    const [t, o] = await Promise.all([
      sb.from("dining_tables").select("id, name, area, active, sort, seats").eq("pizzeria_id", pizzeriaId),
      sb.from("tabs").select("id, table_id, guests, service_fee_pct, service_note, opened_at").eq("pizzeria_id", pizzeriaId).eq("status", "aberta"),
    ]);
    if (t.error || o.error) return null;
    const ids = (o.data as Tab[]).map((x) => x.id);
    const [r, p] = ids.length
      ? await Promise.all([
          sb.from("orders").select("*, order_items(*)").in("tab_id", ids).order("created_at"),
          sb.from("payments").select("id, tab_id, kind, method, amount_cents, change_cents, created_at").in("tab_id", ids).order("created_at"),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (r.error || p.error) return null;
    return { tables: (t.data as DiningTable[]).sort(byName), tabs: o.data as Tab[], rounds: r.data as Round[], pays: p.data as Pay[] };
  }, [sb, pizzeriaId]);
  const apply = useCallback((d: Awaited<ReturnType<typeof fetchAll>>) => {
    setFailed(!d);
    if (!d) return;
    setTables(d.tables);
    setTabs(d.tabs);
    setRounds(d.rounds);
    setPays(d.pays);
  }, []);
  const load = useCallback(async () => apply(await fetchAll()), [apply, fetchAll]);
  const reload = useEffectEvent(() => void load());

  useEffect(() => {
    let alive = true;
    fetchAll().then((d) => alive && apply(d));
    return () => {
      alive = false;
    };
  }, [fetchAll, apply]);

  useEffect(() => {
    // Cozinha mudou uma rodada (pronto) ou outra pessoa mexeu numa mesa.
    const ch = sb
      .channel(`mesas-${pizzeriaId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `pizzeria_id=eq.${pizzeriaId}` }, () => reload())
      .subscribe();
    const poll = setInterval(reload, 10_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      void sb.removeChannel(ch);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [sb, pizzeriaId]);

  if (failed && !tables) {
    return (
      <>
        <PageHeader title="Mesas" />
        <Empty>Não foi possível carregar as mesas. Confira sua conexão.</Empty>
      </>
    );
  }
  if (!tables) {
    return (
      <div className="grid place-items-center py-20">
        <Spinner />
      </div>
    );
  }

  const tabOf = new Map(tabs.map((t) => [t.table_id, t]));
  const roundsOf = (tabId: string) => rounds.filter((r) => r.tab_id === tabId);
  const paysOf = (tabId: string) => pays.filter((p) => p.tab_id === tabId);
  const visible = tables.filter((t) => t.active || tabOf.has(t.id));
  const areas = [...new Set(visible.map((t) => t.area))];
  const busy = visible.filter((t) => tabOf.has(t.id)).length;
  // Mesas livres onde o grupo cabe, da menor para a maior (não desperdiça mesa grande com grupo pequeno).
  const need = Number(group) || 0;
  const fits = need ? visible.filter((t) => t.active && !tabOf.has(t.id) && t.seats != null && t.seats >= need).sort((a, b) => a.seats! - b.seats! || byName(a, b)) : [];
  const fitIds = new Set(fits.map((t) => t.id));
  const selected = tables.find((t) => t.id === openTable) ?? null;
  const pickerTab = tabs.find((t) => t.id === picker);

  return (
    <>
      <PageHeader
        title="Mesas"
        subtitle={visible.length ? `${busy} ocupada${busy === 1 ? "" : "s"} · ${visible.length - busy} livre${visible.length - busy === 1 ? "" : "s"}` : undefined}
        actions={
          canManage && (
            <button className="btn-ghost !py-2 text-sm" onClick={() => setManaging(true)}>
              <Settings2 className="h-4 w-4" /> Cadastrar mesas
            </button>
          )
        }
      />

      {visible.length === 0 ? (
        <Empty>
          {canManage ? (
            <>
              Nenhuma mesa cadastrada.{" "}
              <button className="font-bold text-tomato underline" onClick={() => setManaging(true)}>
                Cadastrar as mesas
              </button>
            </>
          ) : (
            "Nenhuma mesa cadastrada ainda. Peça ao dono ou ao gerente para cadastrar."
          )}
        </Empty>
      ) : (
        <div className="space-y-6">
          <label className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface p-3 text-sm font-bold shadow-[var(--shadow-soft)]">
            <Users className="h-4 w-4" /> Fila de espera: grupo de
            <input aria-label="Pessoas no grupo" className="field !w-16 !py-1 text-center" inputMode="numeric" placeholder="0" value={group} onChange={(e) => setGroup(e.target.value.replace(/D/g, "").slice(0, 2))} />
            pessoas
            {need > 0 && <span className="font-normal text-muted">{fits.length ? `cabe em: ${fits.map((t) => `Mesa ${t.name}`).join(", ")}` : "nenhuma mesa livre com lugares suficientes"}</span>}
            {need > 0 && visible.some((t) => t.seats == null) && (
              <span className="w-full text-xs font-normal text-muted">Mesas sem a quantidade de lugares não entram na busca: preencha em “Cadastrar mesas”.</span>
            )}
          </label>
          <div className="flex flex-wrap gap-3 text-xs font-bold text-muted">
            <Legend cls="border-line bg-surface" label="Livre" />
            <Legend cls="border-dende bg-dende-soft" label="Ocupada" />
            <Legend cls="border-success bg-success-soft" label="Pronto para servir" />
            <Legend cls="border-info bg-info-soft" label="Pagando" />
          </div>
          {areas.map((area) => (
            <section key={area}>
              {areas.length > 1 && <h2 className="mb-2 text-sm font-bold text-muted uppercase">{area}</h2>}
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {visible
                  .filter((t) => t.area === area)
                  .map((t) => {
                    const tab = tabOf.get(t.id);
                    const rs = tab ? roundsOf(tab.id) : [];
                    const tot = tab ? totalsOf(tab, rs, paysOf(tab.id)) : null;
                    const ready = rs.some((r) => r.status === "pronto");
                    const cls = !tab
                      ? "border-line bg-surface"
                      : ready
                        ? "border-success bg-success-soft"
                        : tot!.paid > 0
                          ? "border-info bg-info-soft"
                          : "border-dende bg-dende-soft";
                    return (
                      <button
                        key={t.id}
                        onClick={() => setOpenTable(t.id)}
                        className={`flex min-h-24 flex-col items-start justify-between rounded-2xl border-2 p-3 text-left transition hover:-translate-y-0.5 ${cls} ${need ? (fitIds.has(t.id) ? "ring-4 ring-tomato" : "opacity-40") : ""}`}
                      >
                        <span className="flex w-full items-start justify-between gap-1">
                          <span className="text-xl font-black">{t.name}</span>
                          {t.seats && (
                            <span className="flex items-center gap-0.5 rounded-full bg-sand px-1.5 py-0.5 text-[11px] font-bold" title={seatsLabel(t.seats)}>
                              <Users className="h-3 w-3" /> {t.seats}
                            </span>
                          )}
                        </span>
                        {tab ? (
                          <span className="w-full space-y-0.5 text-xs">
                            <span className="block font-bold">{brl(tot!.total)}</span>
                            <span className="flex items-center gap-1 text-muted">
                              <Clock className="h-3 w-3" /> {minutesSince(tab.opened_at, now)} min
                              {tab.guests ? (
                                <>
                                  {" "}
                                  · {tab.guests} pessoa{tab.guests === 1 ? "" : "s"}
                                </>
                              ) : null}
                            </span>
                            {ready && <span className="block font-bold text-success">Pronto p/ servir</span>}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">{fits[0]?.id === t.id ? <b className="text-tomato">Melhor mesa p/ o grupo</b> : "Livre"}</span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </section>
          ))}
        </div>
      )}

      {selected && !picker && (
        <TableDrawer
          key={selected.id}
          table={selected}
          tab={tabOf.get(selected.id) ?? null}
          rounds={tabOf.has(selected.id) ? roundsOf(tabOf.get(selected.id)!.id) : []}
          pays={tabOf.has(selected.id) ? paysOf(tabOf.get(selected.id)!.id) : []}
          tables={visible}
          tabOf={tabOf}
          role={role}
          storeName={pizzeriaName}
          onClose={() => setOpenTable(null)}
          onChanged={load}
          onLaunch={(tabId) => setPicker(tabId)}
          onGoTo={(tableId) => setOpenTable(tableId)}
        />
      )}
      {pickerTab && (
        <RoundPicker
          menu={menu}
          tabId={pickerTab.id}
          tableName={tables.find((t) => t.id === pickerTab.table_id)?.name ?? ""}
          onClose={() => setPicker(null)}
          onSent={() => {
            setPicker(null);
            void load();
          }}
        />
      )}
      {managing && <TablesManager pizzeriaId={pizzeriaId} tables={tables} defaultFee={defaultFee} onClose={() => setManaging(false)} onChanged={load} />}
    </>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded border-2 ${cls}`} /> {label}
    </span>
  );
}

function TableDrawer({
  table,
  tab,
  rounds,
  pays,
  tables,
  tabOf,
  role,
  storeName,
  onClose,
  onChanged,
  onLaunch,
  onGoTo,
}: {
  table: DiningTable;
  tab: Tab | null;
  rounds: Round[];
  pays: Pay[];
  tables: DiningTable[];
  tabOf: Map<string, Tab>;
  role: Role;
  storeName: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onLaunch: (tabId: string) => void;
  onGoTo: (tableId: string) => void;
}) {
  const sb = browserClient();
  const [busy, setBusy] = useState(false);
  const [guests, setGuests] = useState("");

  const act = async (fn: () => PromiseLike<{ error: unknown }>, ok?: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) toast.error(dbError(error));
    else {
      if (ok) toast.success(ok);
      await onChanged();
    }
    return !error;
  };

  if (!tab) {
    return (
      <Drawer title={`Mesa ${table.name}`} onClose={onClose}>
        <div className="space-y-4">
          <p className="text-sm text-muted">Mesa livre{table.seats ? ` para ${seatsLabel(table.seats)}` : ""}. Abra a conta quando o cliente sentar.</p>
          <label className="block">
            <span className="mb-1 block text-sm font-bold">Quantas pessoas? (opcional)</span>
            <input className="field" inputMode="numeric" placeholder="Ex.: 4" value={guests} onChange={(e) => setGuests(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          </label>
          <button
            className="btn w-full !py-3"
            disabled={busy || !table.active}
            onClick={() => act(() => sb.rpc("open_tab", { _table: table.id, _guests: guests ? Number(guests) : null }), `Mesa ${table.name} aberta`)}
          >
            {busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Abrir mesa
          </button>
          {table.seats && Number(guests) > table.seats && (
            <p className="rounded-xl bg-warning-soft p-2 text-xs font-bold text-warning">O grupo é maior que a mesa ({seatsLabel(table.seats)}). Junte com outra mesa ou escolha uma maior.</p>
          )}
          {!table.active && <p className="text-xs text-danger">Esta mesa está desativada no cadastro.</p>}
        </div>
      </Drawer>
    );
  }

  return (
    <OpenTab
      table={table}
      tab={tab}
      rounds={rounds}
      pays={pays}
      tables={tables}
      tabOf={tabOf}
      role={role}
      storeName={storeName}
      busy={busy}
      act={act}
      onClose={onClose}
      onLaunch={onLaunch}
      onGoTo={onGoTo}
    />
  );
}

function OpenTab({
  table,
  tab,
  rounds,
  pays,
  tables,
  tabOf,
  role,
  storeName,
  busy,
  act,
  onClose,
  onLaunch,
  onGoTo,
}: {
  table: DiningTable;
  tab: Tab;
  rounds: Round[];
  pays: Pay[];
  tables: DiningTable[];
  tabOf: Map<string, Tab>;
  role: Role;
  storeName: string;
  busy: boolean;
  act: (fn: () => PromiseLike<{ error: unknown }>, ok?: string) => Promise<boolean>;
  onClose: () => void;
  onLaunch: (tabId: string) => void;
  onGoTo: (tableId: string) => void;
}) {
  const sb = browserClient();
  const tot = totalsOf(tab, rounds, pays);
  const canReceive = RECEIVERS.includes(role);
  const needsApproval = !["owner", "manager"].includes(role);
  const [people, setPeople] = useState(String(tab.guests ?? 1));
  const n = Math.max(1, Number(people) || 1);
  // Parte de cada um sobre o total (quem já pagou não muda a parte dos outros).
  const share = Math.ceil(tot.total / n);
  const inKitchen = rounds.some((r) => r.status === "confirmado" || r.status === "preparo");
  const otherOpen = tables.filter((t) => t.id !== table.id && tabOf.has(t.id));

  return (
    <Drawer title={`Mesa ${table.name}`} onClose={onClose} wide>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> Aberta às {timeSP(tab.opened_at)}
          </span>
          {tab.guests ? (
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> {tab.guests} pessoa{tab.guests === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>

        <button className="btn w-full !py-3" onClick={() => onLaunch(tab.id)}>
          <ChefHat className="h-4 w-4" /> Lançar itens
        </button>

        <section className="space-y-2">
          <h3 className="font-bold">Rodadas</h3>
          {rounds.length === 0 ? (
            <p className="text-xs text-muted">Nada lançado ainda.</p>
          ) : (
            rounds.map((r) => <RoundCard key={r.id} round={r} needsApproval={needsApproval} otherOpen={otherOpen} tabOf={tabOf} busy={busy} act={act} />)
          )}
        </section>

        <section className="space-y-1 rounded-2xl bg-sand/60 p-4">
          <Line label="Consumo" value={brl(tot.subtotal)} />
          <Line label={`Taxa de serviço (${Number(tab.service_fee_pct)}%)`} value={brl(tot.service)} />
          {tab.service_note && <p className="text-[11px] text-muted">{tab.service_note}</p>}
          <Line label="Total" value={brl(tot.total)} strong />
          {tot.paid > 0 && <Line label="Já pago" value={`− ${brl(tot.paid)}`} />}
          <Line label="Falta pagar" value={brl(Math.max(0, tot.remaining))} strong />
          <div className="flex items-center justify-between gap-2 pt-2">
            <label className="flex items-center gap-2 text-xs font-bold">
              Dividir por
              <input className="field !w-16 !py-1 text-center" inputMode="numeric" value={people} onChange={(e) => setPeople(e.target.value.replace(/\D/g, "").slice(0, 2))} />
              pessoas
            </label>
            <span className="font-bold">{brl(share)} cada</span>
          </div>
        </section>

        <ServiceFee tab={tab} needsApproval={needsApproval} busy={busy} act={act} />

        {canReceive ? (
          tot.remaining > 0 && tot.subtotal > 0 && <Payment tabId={tab.id} remaining={tot.remaining} perPerson={Math.min(share, tot.remaining)} busy={busy} act={act} />
        ) : (
          tot.subtotal > 0 && <p className="rounded-xl bg-info-soft p-3 text-xs text-info">Para receber e fechar a conta, chame o caixa.</p>
        )}

        {pays.length > 0 && (
          <section className="space-y-1">
            <h3 className="font-bold">Pagamentos</h3>
            {pays.map((p) => (
              <p key={p.id} className="flex justify-between text-xs">
                <span>
                  {timeSP(p.created_at)} · {PAYMENT_LABEL[p.method]}
                  {p.change_cents ? ` · troco ${brl(p.change_cents)}` : ""}
                </span>
                <span className="font-bold">{brl(p.amount_cents)}</span>
              </p>
            ))}
          </section>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <button className="btn-ghost" onClick={() => window.print()} disabled={!rounds.length}>
            <Printer className="h-4 w-4" /> Imprimir pré-conta
          </button>
          {tot.subtotal === 0 ? (
            <button className="btn-ghost" disabled={busy} onClick={() => act(() => sb.rpc("close_tab", { _tab: tab.id }), `Mesa ${table.name} liberada`).then((ok) => ok && onClose())}>
              <Check className="h-4 w-4" /> Liberar mesa (sem consumo)
            </button>
          ) : (
            canReceive && (
              <button
                className="btn"
                disabled={busy || tot.remaining > 0 || inKitchen}
                title={inKitchen ? "Ainda tem rodada na cozinha" : tot.remaining > 0 ? "Ainda falta receber" : undefined}
                onClick={() => act(() => sb.rpc("close_tab", { _tab: tab.id }), `Conta da Mesa ${table.name} fechada`).then((ok) => ok && onClose())}
              >
                <Check className="h-4 w-4" /> Fechar conta e liberar
              </button>
            )
          )}
        </div>
        {canReceive && tot.subtotal > 0 && tot.remaining <= 0 && inKitchen && <p className="text-xs text-warning">Ainda tem rodada na cozinha: espere ficar pronta ou cancele.</p>}

        <MoveTable tab={tab} table={table} tables={tables} tabOf={tabOf} busy={busy} act={act} onGoTo={onGoTo} />
      </div>

      <div className="hidden print:block">
        <PreBill storeName={storeName} table={table} tab={tab} rounds={rounds} tot={tot} people={n} share={share} />
      </div>
    </Drawer>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={`flex justify-between ${strong ? "text-base font-bold" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </p>
  );
}

function RoundCard({
  round: r,
  needsApproval,
  otherOpen,
  tabOf,
  busy,
  act,
}: {
  round: Round;
  needsApproval: boolean;
  otherOpen: DiningTable[];
  tabOf: Map<string, Tab>;
  busy: boolean;
  act: (fn: () => PromiseLike<{ error: unknown }>, ok?: string) => Promise<boolean>;
}) {
  const sb = browserClient();
  const [mode, setMode] = useState<"none" | "cancel" | "move">("none");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [dest, setDest] = useState("");
  const open = r.status !== "cancelado" && r.status !== "entregue";

  const cancel = async () => {
    if (needsApproval) {
      const { data, error } = await sb.rpc("request_approval", { _order: r.id, _action: "cancelar", _pin: pin });
      setPin("");
      if (error) return void toast.error(dbError(error));
      toast.message(`Autorizado por ${data as string}`);
    }
    if (await act(() => sb.rpc("transition_order", { _order: r.id, _to: "cancelado", _note: reason }), `Rodada #${r.number} cancelada`)) setMode("none");
  };

  return (
    <div className="rounded-2xl border p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-bold">
          #{r.number} · {timeSP(r.created_at)}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS[r.status].cls}`}>{r.status === "entregue" ? "Servido" : STATUS[r.status].label}</span>
      </div>
      <ul className={`space-y-0.5 text-xs ${r.status === "cancelado" ? "text-muted line-through" : ""}`}>
        {r.order_items.map((i) => (
          <li key={i.id} className="flex justify-between gap-2">
            <span>
              {i.qty}× {i.name}
              {i.size_name ? ` (${i.size_name})` : ""}
              {i.extras.length ? ` + ${i.extras.map((e) => e.name).join(", ")}` : ""}
              {i.note ? ` · ${i.note}` : ""}
            </span>
            <span>{brl(i.subtotal_cents)}</span>
          </li>
        ))}
      </ul>
      {r.notes && <p className="mt-1 text-[11px] text-muted">Obs.: {r.notes}</p>}
      {open && mode === "none" && (
        <div className="mt-2 flex flex-wrap gap-2">
          {r.status === "pronto" && (
            <button className="btn !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => act(() => sb.rpc("transition_order", { _order: r.id, _to: "entregue", _note: null }), `Rodada #${r.number} servida`)}>
              <Check className="h-3.5 w-3.5" /> Servido
            </button>
          )}
          {otherOpen.length > 0 && (
            <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setMode("move")}>
              <ArrowRightLeft className="h-3.5 w-3.5" /> Passar para outra mesa
            </button>
          )}
          <button className="btn-ghost !px-3 !py-1.5 text-xs text-danger" onClick={() => setMode("cancel")}>
            <Ban className="h-3.5 w-3.5" /> Cancelar
          </button>
        </div>
      )}
      {mode === "move" && (
        <div className="mt-2 flex flex-wrap gap-2">
          <select aria-label="Mesa de destino" className="field !w-auto !py-1.5 text-xs" value={dest} onChange={(e) => setDest(e.target.value)}>
            <option value="">Escolha a mesa</option>
            {otherOpen.map((t) => (
              <option key={t.id} value={tabOf.get(t.id)!.id}>
                Mesa {t.name}
              </option>
            ))}
          </select>
          <button
            className="btn !px-3 !py-1.5 text-xs"
            disabled={!dest || busy}
            onClick={() => act(() => sb.rpc("move_round", { _order: r.id, _tab: dest }), `Rodada #${r.number} passada`).then((ok) => ok && setMode("none"))}
          >
            Passar
          </button>
          <button className="text-xs font-bold text-muted" onClick={() => setMode("none")}>
            Voltar
          </button>
        </div>
      )}
      {mode === "cancel" && (
        <div className="mt-2 space-y-2">
          <input className="field !py-2 text-xs" placeholder="Motivo do cancelamento" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          {needsApproval && <PinField value={pin} onChange={setPin} />}
          <div className="flex gap-2">
            <button className="btn !bg-danger !px-3 !py-1.5 text-xs" disabled={busy || reason.trim().length < 3 || (needsApproval && pin.length < 4)} onClick={cancel}>
              Cancelar rodada
            </button>
            <button className="text-xs font-bold text-muted" onClick={() => setMode("none")}>
              Voltar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Taxa de serviço da conta: aumentar é livre; tirar ou baixar pede o PIN do gerente (para caixa, atendente e garçom). */
function ServiceFee({ tab, needsApproval, busy, act }: { tab: Tab; needsApproval: boolean; busy: boolean; act: (fn: () => PromiseLike<{ error: unknown }>, ok?: string) => Promise<boolean> }) {
  const sb = browserClient();
  const [editing, setEditing] = useState(false);
  const [pct, setPct] = useState(String(Number(tab.service_fee_pct)));
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");
  const value = Number(pct.replace(",", "."));
  const lowering = value < Number(tab.service_fee_pct);
  const pinNeeded = needsApproval && lowering;

  const save = async () => {
    if (pinNeeded) {
      const { data, error } = await sb.rpc("request_tab_approval", { _tab: tab.id, _pin: pin });
      setPin("");
      if (error) return void toast.error(dbError(error));
      toast.message(`Autorizado por ${data as string}`);
    }
    if (await act(() => sb.rpc("set_tab_service", { _tab: tab.id, _pct: value, _note: note || null }), value === 0 ? "Taxa de serviço retirada" : `Taxa de serviço: ${value}%`)) setEditing(false);
  };

  if (!editing) {
    return (
      <button className="text-xs font-bold text-muted underline" onClick={() => setEditing(true)}>
        Mudar taxa de serviço
      </button>
    );
  }
  return (
    <section className="space-y-2 rounded-2xl border p-3">
      <h3 className="font-bold">Taxa de serviço</h3>
      <div className="flex flex-wrap gap-2">
        {[0, 10, 12, 15].map((v) => (
          <button key={v} className="chip" data-active={value === v} onClick={() => setPct(String(v))}>
            {v === 0 ? "Sem taxa" : `${v}%`}
          </button>
        ))}
        <input aria-label="Outra porcentagem" className="field !w-20 !py-1 text-center" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d,.]/g, "").slice(0, 5))} />
      </div>
      {lowering && <input className="field !py-2 text-xs" placeholder="Motivo (ex.: cliente pediu)" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />}
      {pinNeeded && <PinField value={pin} onChange={setPin} />}
      <div className="flex gap-2">
        <button className="btn !px-3 !py-1.5 text-xs" disabled={busy || !(value >= 0 && value <= 30) || (pinNeeded && pin.length < 4)} onClick={save}>
          Salvar taxa
        </button>
        <button className="text-xs font-bold text-muted" onClick={() => setEditing(false)}>
          Voltar
        </button>
      </div>
    </section>
  );
}

const METHODS: PaymentMethod[] = ["dinheiro", "pix", "cartao"];

/** Recebe parte ou o total da conta; no dinheiro calcula o troco. */
function Payment({ tabId, remaining, perPerson, busy, act }: { tabId: string; remaining: number; perPerson: number; busy: boolean; act: (fn: () => PromiseLike<{ error: unknown }>, ok?: string) => Promise<boolean> }) {
  const sb = browserClient();
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [amount, setAmount] = useState("");
  const [received, setReceived] = useState("");
  const cents = amount ? parseMoney(amount) : remaining;
  const got = received ? parseMoney(received) : null;
  const change = method === "dinheiro" && got != null && cents != null ? got - cents : null;
  const valid = cents != null && cents > 0 && cents <= remaining && (change == null || change >= 0);

  const pay = async () => {
    if (!valid) return;
    const ok = await act(
      () => sb.rpc("add_tab_payment", { _tab: tabId, _method: method, _amount_cents: cents!, _received_cents: method === "dinheiro" && got != null ? got : null }),
      `${PAYMENT_LABEL[method]}: ${brl(cents!)} recebido${change ? ` · troco ${brl(change)}` : ""}`,
    );
    if (ok) {
      setAmount("");
      setReceived("");
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border p-3">
      <h3 className="flex items-center gap-1.5 font-bold">
        <Wallet className="h-4 w-4" /> Receber
      </h3>
      <div className="flex flex-wrap gap-2">
        {METHODS.map((m) => (
          <button key={m} className="chip" data-active={method === m} onClick={() => setMethod(m)}>
            {PAYMENT_LABEL[m]}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-muted">Valor (vazio = tudo que falta)</span>
          <MoneyInput value={amount} onChange={setAmount} placeholder={brl(remaining)} />
        </label>
        {method === "dinheiro" && (
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-muted">Cliente entregou (para o troco)</span>
            <MoneyInput value={received} onChange={setReceived} />
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <button className="chip" onClick={() => setAmount("")}>
          Tudo ({brl(remaining)})
        </button>
        {perPerson < remaining && (
          <button className="chip" onClick={() => setAmount(centsToInput(perPerson))}>
            Uma parte ({brl(perPerson)})
          </button>
        )}
      </div>
      {change != null && <p className={`text-sm font-bold ${change < 0 ? "text-danger" : "text-success"}`}>{change < 0 ? "Valor entregue menor que o valor a pagar" : `Troco: ${brl(change)}`}</p>}
      {cents != null && cents > remaining && <p className="text-xs text-danger">O valor passa do que falta pagar.</p>}
      <button className="btn w-full" disabled={busy || !valid} onClick={pay}>
        {busy ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />} Receber {cents ? brl(cents) : ""}
      </button>
    </section>
  );
}

/** Trocar o grupo de mesa (destino livre) ou juntar as contas (destino ocupado). */
function MoveTable({
  tab,
  table,
  tables,
  tabOf,
  busy,
  act,
  onGoTo,
}: {
  tab: Tab;
  table: DiningTable;
  tables: DiningTable[];
  tabOf: Map<string, Tab>;
  busy: boolean;
  act: (fn: () => PromiseLike<{ error: unknown }>, ok?: string) => Promise<boolean>;
  onGoTo: (tableId: string) => void;
}) {
  const sb = browserClient();
  const [dest, setDest] = useState("");
  const others = tables.filter((t) => t.id !== table.id && t.active);
  const target = others.find((t) => t.id === dest);
  const targetTab = target ? tabOf.get(target.id) : undefined;
  if (!others.length) return null;

  const go = async () => {
    if (!target) return;
    const ok = targetTab
      ? await act(() => sb.rpc("merge_tabs", { _from: tab.id, _into: targetTab.id }), `Mesa ${table.name} juntada com a Mesa ${target.name}`)
      : await act(() => sb.rpc("move_tab", { _tab: tab.id, _table: target.id }), `Conta passada para a Mesa ${target.name}`);
    if (ok) onGoTo(target.id);
  };

  return (
    <section className="space-y-2 border-t pt-4">
      <h3 className="font-bold">Trocar ou juntar mesa</h3>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Mesa de destino" className="field !w-auto !py-2" value={dest} onChange={(e) => setDest(e.target.value)}>
          <option value="">Escolha a mesa</option>
          {others.map((t) => (
            <option key={t.id} value={t.id}>
              Mesa {t.name} {tabOf.has(t.id) ? "(ocupada: juntar contas)" : "(livre)"}
            </option>
          ))}
        </select>
        <button className="btn-ghost" disabled={!target || busy} onClick={go}>
          <ArrowRightLeft className="h-4 w-4" /> {targetTab ? "Juntar contas" : "Trocar de mesa"}
        </button>
      </div>
      {targetTab && <p className="text-xs text-muted">Tudo desta mesa (rodadas e pagamentos) vai para a Mesa {target!.name}, e esta fica livre.</p>}
    </section>
  );
}

function PinField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-xs font-bold text-muted">
        <KeyRound className="h-3.5 w-3.5" /> PIN do gerente ou do dono (autorização)
      </span>
      <input
        className="field !py-2 text-center font-mono text-xl tracking-[0.5em]"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        placeholder="••••"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
      />
    </label>
  );
}

/** Pré-conta para levar à mesa (impressora térmica de 80 mm ou PDF). */
function PreBill({ storeName, table, tab, rounds, tot, people, share }: { storeName: string; table: DiningTable; tab: Tab; rounds: Round[]; tot: Totals; people: number; share: number }) {
  const items = rounds.filter((r) => r.status !== "cancelado").flatMap((r) => r.order_items);
  return (
    <div id="comprovante" className="font-mono text-xs leading-relaxed text-ink">
      <p className="text-center text-sm font-bold">{storeName}</p>
      <p className="mt-1 text-center text-base font-bold">MESA {table.name}</p>
      <p className="text-center">Pré-conta · aberta às {timeSP(tab.opened_at)}</p>
      <div className="my-2 border-t border-dashed border-ink" />
      {items.map((i) => (
        <div key={i.id} className="mb-1">
          <div className="flex justify-between gap-2">
            <span>
              {i.qty}× {i.name}
              {i.size_name ? ` (${i.size_name})` : ""}
            </span>
            <span>{brl(i.subtotal_cents)}</span>
          </div>
          {i.extras.length > 0 && <p className="pl-3">+ {i.extras.map((e) => e.name).join(", ")}</p>}
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-ink" />
      <div className="flex justify-between">
        <span>Consumo</span>
        <span>{brl(tot.subtotal)}</span>
      </div>
      <div className="flex justify-between">
        <span>Serviço ({Number(tab.service_fee_pct)}%, opcional)</span>
        <span>{brl(tot.service)}</span>
      </div>
      <div className="flex justify-between text-sm font-bold">
        <span>TOTAL</span>
        <span>{brl(tot.total)}</span>
      </div>
      {tot.paid > 0 && (
        <>
          <div className="flex justify-between">
            <span>Já pago</span>
            <span>− {brl(tot.paid)}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>FALTA</span>
            <span>{brl(tot.remaining)}</span>
          </div>
        </>
      )}
      {people > 1 && <p className="mt-1">Dividido por {people}: {brl(share)} cada</p>}
      <p className="mt-3 text-center text-[10px]">Documento sem valor fiscal</p>
    </div>
  );
}
