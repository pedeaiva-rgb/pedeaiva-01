import type { Metadata } from "next";
import { can, getTenant } from "@/lib/tenant";
import { NoAccess } from "../no-access";
import { DeliveryBoard } from "./delivery-board";

export const metadata: Metadata = { title: "Entregas" };

export default async function EntregasPage() {
  const t = (await getTenant())!;
  if (!can(t.role, "entregas")) return <NoAccess />;
  return <DeliveryBoard pizzeriaId={t.pizzeria.id} role={t.role} />;
}
