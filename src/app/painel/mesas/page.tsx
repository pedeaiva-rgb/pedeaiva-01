import type { Metadata } from "next";
import { Panel } from "@/components/ui";
import { loadMenu } from "@/lib/menu";
import { createClient } from "@/lib/supabase/server";
import { allowed, getTenant } from "@/lib/tenant";
import { NoAccess } from "../no-access";
import { MesasBoard } from "./mesas-board";

export const metadata: Metadata = { title: "Mesas" };

export default async function MesasPage() {
  const t = (await getTenant())!;
  if (!allowed(t, "mesas")) return <NoAccess />;
  const sb = await createClient();
  const [menu, check] = await Promise.all([loadMenu(sb, { id: t.pizzeria.id }), sb.from("dining_tables").select("id, seats").limit(1)]);
  if (check.error) {
    return (
      <Panel title="Mesas">
        <p className="text-sm">
          Falta rodar no Supabase os SQL das mesas, nesta ordem: <code className="rounded bg-sand px-1">20261025070000_mesas_enums.sql</code>,{" "}
          <code className="rounded bg-sand px-1">20261025080000_mesas.sql</code> e{" "}
          <code className="rounded bg-sand px-1">20261025090000_mesas_lugares.sql</code>.
        </p>
      </Panel>
    );
  }
  return (
    <MesasBoard
      pizzeriaId={t.pizzeria.id}
      pizzeriaName={t.pizzeria.name}
      menu={menu!}
      role={t.role}
      canManage={allowed(t, "configuracoes")}
      defaultFee={Number(t.pizzeria.service_fee_pct ?? 10)}
    />
  );
}
