import type { Metadata } from "next";
import { headers } from "next/headers";
import { Panel } from "@/components/ui";
import type { CustomerRow } from "@/lib/customers";
import { serverNow } from "@/lib/dashboard";
import { createClient } from "@/lib/supabase/server";
import { allowed, allowedPerm, getTenant } from "@/lib/tenant";
import { NoAccess } from "../no-access";
import { CustomersBoard } from "./customers-board";

export const metadata: Metadata = { title: "Clientes" };

export default async function ClientesPage() {
  const t = (await getTenant())!;
  if (!allowed(t, "clientes")) return <NoAccess />;
  const [sb, h] = await Promise.all([createClient(), headers()]);
  const [stats, coupons] = await Promise.all([sb.rpc("customer_stats", { _pz: t.pizzeria.id }), sb.rpc("staff_coupons", { _pz: t.pizzeria.id })]);
  if (stats.error) {
    return (
      <Panel title="Clientes">
        <p className="text-sm">
          Falta rodar no Supabase o SQL <code className="rounded bg-sand px-1">20261026020000_clientes_fidelidade.sql</code>.
        </p>
      </Panel>
    );
  }
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const now = serverNow();
  const rows = ((stats.data ?? []) as (Omit<CustomerRow, "spent_cents"> & { spent_cents: number | string })[]).map((c) => ({ ...c, spent_cents: Number(c.spent_cents) }));
  return (
    <CustomersBoard
      customers={rows}
      coupons={((coupons.data ?? []) as { code: string }[]).map((c) => c.code)}
      store={{ name: t.pizzeria.name, link: `${origin}/${t.pizzeria.slug}` }}
      now={now}
      month={Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", month: "numeric" }).format(new Date(now)))}
      canSeeMoney={t.role !== "manager" || allowedPerm(t, "faturamento")}
    />
  );
}
