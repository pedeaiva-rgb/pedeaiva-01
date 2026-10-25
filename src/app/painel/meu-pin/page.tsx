import type { Metadata } from "next";
import { Panel } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant";
import { PinForm } from "./pin-form";

export const metadata: Metadata = { title: "Meu PIN" };

export default async function MeuPinPage() {
  const t = (await getTenant())!;
  const sb = await createClient();
  const { data, error } = await sb.rpc("my_pin_status", { _pz: t.pizzeria.id });
  if (error) {
    return (
      <Panel title="Meu PIN">
        <p className="text-sm">
          Falta rodar no Supabase o SQL <code className="rounded bg-sand px-1">20261025030000_balcao_pin.sql</code>.
        </p>
      </Panel>
    );
  }
  return <PinForm pizzeriaId={t.pizzeria.id} hasPin={data === true} approver={t.role === "owner" || t.role === "manager"} />;
}
