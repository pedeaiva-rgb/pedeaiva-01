import type { Metadata } from "next";
import { Panel } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/order-labels";
import { createClient } from "@/lib/supabase/server";
import { can, getTenant } from "@/lib/tenant";
import type { Role } from "@/lib/types";
import { NoAccess } from "../no-access";
import { CashRegister, type ClosedCash, type Movement, type OpenCash } from "./cash-register";

export const metadata: Metadata = { title: "Caixa do dia" };

export default async function CaixaPage() {
  const t = (await getTenant())!;
  if (!can(t.role, "caixa")) return <NoAccess />;
  const sb = await createClient();
  const pz = t.pizzeria.id;
  const [cur, hist, team] = await Promise.all([
    sb.rpc("cash_current", { _pz: pz }),
    sb
      .from("cash_sessions")
      .select("id, opened_at, closed_at, opened_by, closed_by, opening_cents, counted_cents, expected_cents, difference_cents, summary, note")
      .eq("pizzeria_id", pz)
      .eq("status", "fechado")
      .order("closed_at", { ascending: false })
      .limit(15),
    sb.from("members").select("user_id, display_name, role").eq("pizzeria_id", pz),
  ]);
  if (cur.error) {
    return (
      <Panel title="Caixa do dia">
        <p className="text-sm">
          Falta rodar no Supabase o SQL <code className="rounded bg-sand px-1">20261025050000_caixa_do_dia.sql</code>.
        </p>
      </Panel>
    );
  }
  // Sem nome cadastrado, mostra a função (ex.: "Proprietário").
  const names = new Map(((team.data ?? []) as { user_id: string; display_name: string | null; role: Role }[]).map((m) => [m.user_id, m.display_name ?? ROLE_LABEL[m.role]]));
  const current = cur.data as OpenCash | null;
  const movs = current
    ? ((await sb.from("cash_movements").select("id, kind, amount_cents, reason, created_at, actor_id").eq("session_id", current.id).order("created_at")).data ?? [])
    : [];
  const history = ((hist.data ?? []) as (Omit<ClosedCash, "opened_by" | "closed_by"> & { opened_by: string; closed_by: string })[]).map((h) => ({
    ...h,
    opened_by: names.get(h.opened_by) ?? null,
    closed_by: names.get(h.closed_by) ?? null,
  }));
  return (
    <CashRegister
      pizzeriaId={pz}
      pizzeriaName={t.pizzeria.name}
      current={current}
      movements={(movs as (Omit<Movement, "actor"> & { actor_id: string | null })[]).map((m) => ({ ...m, actor: m.actor_id ? (names.get(m.actor_id) ?? null) : null }))}
      history={history}
      isBoss={t.role === "owner" || t.role === "manager"}
    />
  );
}
