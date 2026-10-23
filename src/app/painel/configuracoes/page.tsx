import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { can, getTenant } from "@/lib/tenant";
import type { DeliveryZone, Pizzeria } from "@/lib/types";
import { NoAccess } from "../no-access";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Configurações" };

export default async function ConfiguracoesPage() {
  const t = (await getTenant())!;
  if (!can(t.role, "configuracoes")) return <NoAccess />;
  const sb = await createClient();
  const [pz, zones] = await Promise.all([
    sb.from("pizzerias").select("*").eq("id", t.pizzeria.id).single(),
    sb.from("delivery_zones").select("*").eq("pizzeria_id", t.pizzeria.id).order("name"),
  ]);
  return <SettingsForm pizzeria={pz.data as Pizzeria} zones={(zones.data ?? []) as DeliveryZone[]} />;
}
