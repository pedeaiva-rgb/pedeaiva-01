import type { Metadata } from "next";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { can, getTenant } from "@/lib/tenant";
import type { DeliveryZone, Pizzeria } from "@/lib/types";
import { NoAccess } from "../no-access";
import { DeliveryRules } from "./delivery-rules";
import { KitchenLink, type KitchenLinkInfo } from "./kitchen-link";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Configurações" };

export default async function ConfiguracoesPage() {
  const t = (await getTenant())!;
  if (!can(t.role, "configuracoes")) return <NoAccess />;
  const [sb, h] = await Promise.all([createClient(), headers()]);
  const [pz, zones, kitchen] = await Promise.all([
    sb.from("pizzerias").select("*").eq("id", t.pizzeria.id).single(),
    sb.from("delivery_zones").select("*").eq("pizzeria_id", t.pizzeria.id).order("name"),
    // Sem a migração do link da cozinha, a função ainda não existe (o painel mostra o aviso).
    sb.rpc("kitchen_link", { _pz: t.pizzeria.id }),
  ]);
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  return (
    <>
      <SettingsForm pizzeria={pz.data as Pizzeria} zones={(zones.data ?? []) as DeliveryZone[]} />
      <KitchenLink pizzeriaId={t.pizzeria.id} info={(kitchen.data as KitchenLinkInfo[] | null)?.[0] ?? null} origin={origin} />
      <DeliveryRules pizzeria={pz.data as Pizzeria} />
    </>
  );
}
