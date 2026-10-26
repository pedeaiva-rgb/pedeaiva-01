"use client";

import { useEffect, useMemo, useState } from "react";
import { Cake, Download, Gift, MessageCircle, Search, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Drawer, Empty, PageHeader, Spinner } from "@/components/ui";
import { daysSince, inSegment, message, search, TEMPLATE_LABEL, whatsappUrl, type CustomerRow, type Segment, type Template } from "@/lib/customers";
import { dbError } from "@/lib/db-error";
import { brl } from "@/lib/money";
import { STATUS } from "@/lib/order-labels";
import { formatBrPhone } from "@/lib/phone";
import { csvMoney, toCsv } from "@/lib/reports";
import { browserClient } from "@/lib/supabase/client";
import type { OrderStatus } from "@/lib/types";

const SEGMENTS: [Segment, string][] = [
  ["todos", "Todos"],
  ["melhores", "Melhores clientes"],
  ["sumidos", "Sumidos (30+ dias)"],
  ["novos", "Novos (30 dias)"],
  ["aniversario", "Aniversariantes do mês"],
  ["sem_pedido", "Sem pedido"],
];
type Sort = "gasto" | "pedidos" | "recente" | "nome";
const dateBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const bday = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
const ago = (n: number | null) => (n == null ? "—" : n === 0 ? "hoje" : n === 1 ? "ontem" : `há ${n} dias`);

export function CustomersBoard({
  customers,
  coupons,
  store,
  now,
  month,
  canSeeMoney,
}: {
  customers: CustomerRow[];
  coupons: string[];
  store: { name: string; link: string };
  now: number;
  month: number;
  canSeeMoney: boolean;
}) {
  const [list, setList] = useState(customers);
  const [seg, setSeg] = useState<Segment>("todos");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("gasto");
  const [open, setOpen] = useState<string | null>(null);
  const money = (c: number) => (canSeeMoney ? brl(c) : "—");

  const counts = useMemo(() => Object.fromEntries(SEGMENTS.map(([s]) => [s, inSegment(list, s, now, month).length])), [list, now, month]);
  const shown = useMemo(() => {
    const l = search(inSegment(list, seg, now, month), q);
    if (seg === "aniversario" || seg === "melhores") return l;
    return [...l].sort((a, b) =>
      sort === "gasto"
        ? b.spent_cents - a.spent_cents
        : sort === "pedidos"
          ? b.orders - a.orders
          : sort === "nome"
            ? a.name.localeCompare(b.name, "pt-BR")
            : (b.last_order_at ?? "").localeCompare(a.last_order_at ?? ""),
    );
  }, [list, seg, q, sort, now, month]);
  const selected = list.find((c) => c.id === open) ?? null;

  const exportCsv = () => {
    const rows = [
      ["Nome", "Telefone", "Pedidos", "Total gasto", "Primeiro pedido", "Último pedido", "Aniversário", "Não quer ofertas", "Observações"],
      ...shown.map((c) => [
        c.name,
        formatBrPhone(c.phone),
        c.orders,
        canSeeMoney ? csvMoney(c.spent_cents) : "",
        c.first_order_at ? dateBR(c.first_order_at) : "",
        c.last_order_at ? dateBR(c.last_order_at) : "",
        c.birthday ? bday(c.birthday) : "",
        c.marketing_opt_out ? "Sim" : "Não",
        c.notes ?? "",
      ]),
    ];
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `clientes-${seg}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle={`${list.length} cliente${list.length === 1 ? "" : "s"} · quem já pediu pela loja online, PDV ou telefone`}
        actions={
          <button className="btn-ghost !py-2 text-sm" onClick={exportCsv} disabled={!shown.length}>
            <Download className="h-4 w-4" /> Baixar planilha
          </button>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {SEGMENTS.map(([s, label]) => (
          <button key={s} className="chip" data-active={seg === s} onClick={() => setSeg(s)}>
            {label} <span className="text-xs opacity-60">{counts[s]}</span>
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <label className="relative min-w-56 flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="field !pl-9" placeholder="Buscar por nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {seg !== "aniversario" && seg !== "melhores" && (
          <select aria-label="Ordenar" className="field !w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="gasto">Mais gastaram</option>
            <option value="pedidos">Mais pedidos</option>
            <option value="recente">Pediram por último</option>
            <option value="nome">Nome (A–Z)</option>
          </select>
        )}
      </div>

      {seg === "sumidos" && shown.length > 0 && (
        <p className="mb-3 rounded-2xl bg-info-soft p-3 text-sm text-info">
          Clientes que já pediram e não voltam há mais de 30 dias. Abra o cliente e mande uma mensagem com um cupom para trazer de volta.
        </p>
      )}

      {shown.length === 0 ? (
        <Empty>{list.length ? "Nenhum cliente neste filtro." : "Ainda não há clientes. Eles aparecem aqui quando fazem o primeiro pedido com telefone."}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-sand text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2 text-right">Pedidos</th>
                <th className="px-3 py-2 text-right">Gastou</th>
                <th className="px-3 py-2 text-right">Último pedido</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 300).map((c) => (
                <tr key={c.id} className="cursor-pointer border-t hover:bg-sand/40" onClick={() => setOpen(c.id)}>
                  <td className="px-3 py-2">
                    <p className="font-bold">{c.name || "Sem nome"}</p>
                    <p className="text-xs text-muted">
                      {formatBrPhone(c.phone)}
                      {c.birthday ? ` · 🎂 ${bday(c.birthday)}` : ""}
                      {c.marketing_opt_out ? " · não quer ofertas" : ""}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.orders}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(c.spent_cents)}</td>
                  <td className="px-3 py-2 text-right text-xs">{ago(daysSince(c.last_order_at, now))}</td>
                  <td className="px-3 py-2 text-right">
                    <a
                      href={whatsappUrl(c.phone, `Oi, ${c.name.split(" ")[0]}! Aqui é da ${store.name}. `)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`WhatsApp de ${c.name}`}
                      className="inline-grid h-8 w-8 place-items-center rounded-full text-success hover:bg-success-soft"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 300 && <p className="border-t p-3 text-xs text-muted">Mostrando 300 de {shown.length}. Use a busca ou baixe a planilha para ver todos.</p>}
        </div>
      )}

      {selected && (
        <CustomerDrawer
          key={selected.id}
          c={selected}
          coupons={coupons}
          store={store}
          now={now}
          money={money}
          seg={seg}
          onClose={() => setOpen(null)}
          onSaved={(u) => setList((l) => l.map((x) => (x.id === u.id ? u : x)))}
        />
      )}
    </>
  );
}

type HistoryRow = { id: string; number: number; created_at: string; status: OrderStatus; total_cents: number; channel: string };
type Reward = { code: string; discount_type: "valor" | "percentual"; value: number; ends_at: string | null; origin: string; used: boolean };
const rewardText = (r: Pick<Reward, "discount_type" | "value">) => (r.discount_type === "percentual" ? `${Number(r.value)}% de desconto` : `${brl(Math.round(Number(r.value) * 100))} de desconto`);
const ORIGIN = { fidelidade: "Cartão fidelidade", cashback: "Cashback", aniversario: "Aniversário", manual: "Cupom" } as Record<string, string>;

function CustomerDrawer({
  c,
  coupons,
  store,
  now,
  money,
  seg,
  onClose,
  onSaved,
}: {
  c: CustomerRow;
  coupons: string[];
  store: { name: string; link: string };
  now: number;
  money: (v: number) => string;
  seg: Segment;
  onClose: () => void;
  onSaved: (c: CustomerRow) => void;
}) {
  const sb = browserClient();
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [birthday, setBirthday] = useState(c.birthday ?? "");
  const [notes, setNotes] = useState(c.notes ?? "");
  const [optOut, setOptOut] = useState(c.marketing_opt_out);
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState<Template>(seg === "aniversario" ? "aniversario" : seg === "sumidos" ? "reativar" : "livre");
  const [coupon, setCoupon] = useState("");
  const [text, setText] = useState<string | null>(null);
  const msg = text ?? message(tpl, { customer: c.name, store: store.name, coupon: coupon || null, link: store.link });

  useEffect(() => {
    let alive = true;
    sb.from("orders")
      .select("id,number,created_at,status,total_cents,channel")
      .eq("customer_id", c.id)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => alive && setHistory((data ?? []) as HistoryRow[]));
    sb.rpc("customer_coupons", { _customer: c.id }).then(({ data }) => alive && setRewards((data ?? []) as Reward[]));
    return () => {
      alive = false;
    };
  }, [sb, c.id]);

  const save = async () => {
    setBusy(true);
    const { error } = await sb.rpc("update_customer", { _id: c.id, _birthday: birthday || null, _notes: notes, _opt_out: optOut });
    setBusy(false);
    if (error) return void toast.error(dbError(error));
    toast.success("Cliente salvo");
    onSaved({ ...c, birthday: birthday || null, notes: notes.trim() || null, marketing_opt_out: optOut });
  };

  const gift = async () => {
    setBusy(true);
    const { data, error } = await sb.rpc("birthday_coupon", { _customer: c.id, _type: "percentual", _value: 10, _days: 15 });
    setBusy(false);
    if (error) return void toast.error(dbError(error));
    const code = data as string;
    setRewards((r) => [{ code, discount_type: "percentual", value: 10, ends_at: null, origin: "aniversario", used: false }, ...r]);
    // Mensagem de aniversário só quando é aniversário; senão, "presente".
    const m = new Date(now).getUTCMonth() + 1;
    setTpl(birthday && Number(birthday.slice(5, 7)) === m ? "aniversario" : "premio");
    setCoupon(code);
    setText(null);
    toast.success(`Presente criado: ${code} (10% de desconto, vale 15 dias, só para este cliente)`);
  };

  const active = rewards.filter((r) => !r.used && (!r.ends_at || new Date(r.ends_at).getTime() > now));
  const promo = tpl !== "livre";

  return (
    <Drawer title={c.name || "Cliente"} onClose={onClose} wide>
      <div className="space-y-5 text-sm">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Pedidos" value={String(c.orders)} />
          <Stat label="Gastou" value={money(c.spent_cents)} />
          <Stat label="Último pedido" value={ago(daysSince(c.last_order_at, now))} />
        </div>
        <p className="text-xs text-muted">
          {formatBrPhone(c.phone)} · cliente desde {dateBR(c.first_order_at ?? c.created_at)}
          {c.orders > 0 ? ` · ticket médio ${money(Math.round(c.spent_cents / c.orders))}` : ""}
        </p>

        <section className="space-y-3 rounded-2xl border p-3">
          <h3 className="flex items-center gap-1.5 font-bold">
            <MessageCircle className="h-4 w-4 text-success" /> Mandar mensagem no WhatsApp
          </h3>
          {optOut && promo && (
            <p className="flex items-center gap-1.5 rounded-xl bg-dende-soft p-2 text-xs font-bold text-warning">
              <ShieldOff className="h-3.5 w-3.5" /> Este cliente pediu para não receber ofertas.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TEMPLATE_LABEL) as Template[]).map((t) => (
              <button
                key={t}
                className="chip"
                data-active={tpl === t}
                onClick={() => {
                  setTpl(t);
                  setText(null);
                }}
              >
                {TEMPLATE_LABEL[t]}
              </button>
            ))}
          </div>
          {promo && (
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-muted">Cupom na mensagem (opcional)</span>
              <select
                className="field"
                value={coupon}
                onChange={(e) => {
                  setCoupon(e.target.value);
                  setText(null);
                }}
              >
                <option value="">Sem cupom</option>
                {active.length > 0 && (
                  <optgroup label="Prêmios deste cliente">
                    {active.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.code} · {rewardText(r)}
                      </option>
                    ))}
                  </optgroup>
                )}
                {coupons.length > 0 && (
                  <optgroup label="Cupons da loja">
                    {coupons.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          )}
          <textarea className="field text-sm" rows={4} value={msg} onChange={(e) => setText(e.target.value)} maxLength={900} />
          <div className="flex flex-wrap gap-2">
            <a href={whatsappUrl(c.phone, msg)} target="_blank" rel="noreferrer" className="btn">
              <MessageCircle className="h-4 w-4" /> Abrir no WhatsApp
            </a>
            <button className="btn-ghost" disabled={busy} onClick={gift}>
              {busy ? <Spinner className="h-4 w-4" /> : <Gift className="h-4 w-4" />} Criar presente (10%, só dele)
            </button>
          </div>
          <p className="text-[11px] text-muted">A mensagem abre no WhatsApp para você revisar e enviar. Nada é enviado sozinho.</p>
        </section>

        <section className="space-y-2">
          <h3 className="font-bold">Prêmios e cupons pessoais</h3>
          {rewards.length === 0 ? (
            <p className="text-xs text-muted">Nenhum ainda.</p>
          ) : (
            <ul className="space-y-1">
              {rewards.map((r) => (
                <li key={r.code} className={`flex justify-between gap-2 rounded-xl bg-sand/60 px-3 py-1.5 text-xs ${r.used ? "text-muted line-through" : ""}`}>
                  <span>
                    <b>{r.code}</b> · {ORIGIN[r.origin] ?? r.origin} · {rewardText(r)}
                  </span>
                  <span>{r.used ? "usado" : r.ends_at ? `vale até ${dateBR(r.ends_at)}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2 rounded-2xl border p-3">
          <h3 className="font-bold">Dados do cliente</h3>
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-xs font-bold text-muted">
              <Cake className="h-3.5 w-3.5" /> Data de nascimento
            </span>
            <input type="date" className="field !w-auto" value={birthday} max={new Date(now).toISOString().slice(0, 10)} onChange={(e) => setBirthday(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-muted">Observações (só a equipe vê)</span>
            <textarea className="field" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: prefere sem cebola, portão azul" />
          </label>
          <label className="flex items-center gap-2 text-xs font-bold">
            <input type="checkbox" checked={optOut} onChange={(e) => setOptOut(e.target.checked)} /> Não quer receber ofertas
          </label>
          <button className="btn-ghost !py-2 text-sm" disabled={busy} onClick={save}>
            Salvar dados
          </button>
        </section>

        <section className="space-y-2">
          <h3 className="font-bold">Últimos pedidos</h3>
          {!history ? (
            <Spinner />
          ) : history.length === 0 ? (
            <p className="text-xs text-muted">Nenhum pedido.</p>
          ) : (
            <ul className="divide-y rounded-2xl border">
              {history.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <span>
                    <b>#{o.number}</b> · {dateBR(o.created_at)}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 font-bold ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
                  <span className="font-bold tabular-nums">{money(o.total_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-sand/60 p-3">
      <p className="text-[11px] font-bold text-muted">{label}</p>
      <p className="text-base font-extrabold">{value}</p>
    </div>
  );
}
