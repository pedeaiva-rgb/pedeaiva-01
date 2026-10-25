import type { Metadata } from "next";
import { Panel } from "@/components/ui";
import { storeCity } from "@/lib/address-points";
import { createClient, getUser } from "@/lib/supabase/server";
import { can, getTenant } from "@/lib/tenant";
import type { Courier } from "@/lib/types";
import { NoAccess } from "../no-access";
import { DriverApp } from "./driver-app";

export const metadata: Metadata = { title: "Minhas entregas" };

export default async function EntregadorPage() {
  const t = (await getTenant())!;
  if (!can(t.role, "entregador")) return <NoAccess />;
  const [sb, user] = await Promise.all([createClient(), getUser()]);
  const { data } = await sb.from("couriers").select("*").eq("pizzeria_id", t.pizzeria.id).eq("user_id", user!.id).maybeSingle();
  const courier = data as Courier | null;
  if (!courier || !courier.active) {
    return (
      <Panel title="Minhas entregas">
        <p className="text-sm">
          {courier ? "Seu cadastro de entregador está desativado nesta loja." : "Seu cadastro de entregador ainda não foi criado nesta loja."} Fale com o responsável
          pela pizzaria.
        </p>
      </Panel>
    );
  }
  return (
    <DriverApp
      pizzeriaId={t.pizzeria.id}
      courier={courier}
      selfAssign={t.pizzeria.couriers_self_assign ?? true}
      requireCode={t.pizzeria.require_delivery_code ?? true}
      city={storeCity(t.pizzeria.address)}
    />
  );
}
