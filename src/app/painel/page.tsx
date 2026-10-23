import Link from "next/link";
import { CheckCircle2, Circle, Clock, Monitor, Pizza, Receipt, Wallet } from "lucide-react";
import { Panel } from "@/components/ui";
import { brl } from "@/lib/money";
import { CHANNEL_LABEL, STATUS } from "@/lib/order-labels";
import { createClient } from "@/lib/supabase/server";
import { can, getTenant, startOfTodaySP } from "@/lib/tenant";
import type { Channel, OrderStatus } from "@/lib/types";
import { CopyLink } from "./copy-link";

type Row = { id: string; number: number; status: OrderStatus; total_cents: number; customer_name: string; channel: Channel; created_at: string };

export default async function Overview() {
  const t = (await getTenant())!;
  const pz = t.pizzeria;
  const sb = await createClient();
  const since = startOfTodaySP().toISOString();
  const [orders, payments, products, prices] = await Promise.all([
    sb.from("orders").select("id,number,status,total_cents,customer_name,channel,created_at").eq("pizzeria_id", pz.id).gte("created_at", since).order("created_at", { ascending: false }),
    can(t.role, "pdv") ? sb.from("payments").select("kind,amount_cents").eq("pizzeria_id", pz.id).gte("created_at", since) : Promise.resolve({ data: [] }),
    sb.from("products").select("id,is_pizza").eq("pizzeria_id", pz.id).eq("archived", false),
    sb.from("product_prices").select("product_id").eq("pizzeria_id", pz.id),
  ]);
  const list = (orders.data ?? []) as Row[];
  const valid = list.filter((o) => o.status !== "cancelado");
  const confirmed = valid.filter((o) => o.status !== "novo");
  const received = ((payments.data ?? []) as { kind: string; amount_cents: number }[]).reduce((a, p) => a + (p.kind === "recebimento" ? p.amount_cents : -p.amount_cents), 0);
  const open = valid.filter((o) => !["entregue"].includes(o.status)).length;

  const prods = (products.data ?? []) as { id: string; is_pizza: boolean }[];
  const priced = new Set(((prices.data ?? []) as { product_id: string }[]).map((p) => p.product_id));
  const checklist = [
    { done: prods.length > 0, label: "Cadastrar os produtos do cardápio", href: "/painel/cardapio" },
    { done: prods.filter((p) => p.is_pizza).every((p) => priced.has(p.id)) && prods.some((p) => p.is_pizza), label: "Dar preço às pizzas em cada tamanho", href: "/painel/cardapio" },
    { done: !!pz.phone, label: "Informar telefone e endereço da loja", href: "/painel/configuracoes" },
    { done: Object.keys((pz.opening_hours as object) ?? {}).length > 0, label: "Definir o horário de funcionamento", href: "/painel/configuracoes" },
  ];
  const pending = checklist.filter((c) => !c.done);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Olá! Este é o dia da {pz.name}.</h1>
          <p className="text-sm text-muted">Números de hoje, no horário de Brasília.</p>
        </div>
        <CopyLink slug={pz.slug} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ["Pedidos hoje", String(valid.length), Receipt, `${list.length - valid.length} cancelado(s)`],
            ["Aguardando confirmação", String(valid.filter((o) => o.status === "novo").length), Clock, "confirme em Pedidos"],
            ["Vendido hoje", brl(confirmed.reduce((a, o) => a + o.total_cents, 0)), Pizza, "pedidos confirmados"],
            ["Recebido hoje", can(t.role, "pdv") ? brl(received) : "—", Wallet, "registrado no caixa, já descontados estornos"],
          ] as const
        ).map(([label, value, Icon, hint]) => (
          <div key={label} className="card p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-muted">{label}</p>
              <Icon className="h-4 w-4 text-tomato" />
            </div>
            <p className="mt-2 font-brand text-2xl font-extrabold">{value}</p>
            <p className="mt-1 text-[11px] text-muted">{hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
        <Panel
          title={`Pedidos de hoje${open ? ` · ${open} em aberto` : ""}`}
          action={
            <Link href="/painel/pedidos" className="text-xs font-bold text-tomato">
              Abrir pedidos
            </Link>
          }
        >
          {list.length === 0 ? (
            <p className="rounded-2xl bg-sand/60 p-6 text-center text-sm text-muted">Nenhum pedido hoje ainda. Divulgue o link da loja!</p>
          ) : (
            <ul className="divide-y">
              {list.slice(0, 8).map((o) => (
                <li key={o.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-charcoal text-[11px] font-bold text-cream">#{o.number}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{o.customer_name}</p>
                    <p className="text-xs text-muted">
                      {new Date(o.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })} · {CHANNEL_LABEL[o.channel]}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{brl(o.total_cents)}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
                  </div>
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
        </div>
      </div>
    </>
  );
}
