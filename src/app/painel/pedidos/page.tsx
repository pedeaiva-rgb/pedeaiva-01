import type { Metadata } from "next";
import { can, getTenant } from "@/lib/tenant";
import { NoAccess } from "../no-access";
import { OrdersBoard } from "./orders-board";

export const metadata: Metadata = { title: "Pedidos" };

export default async function PedidosPage() {
  const t = (await getTenant())!;
  if (!can(t.role, "pedidos")) return <NoAccess />;
  return <OrdersBoard pizzeriaId={t.pizzeria.id} pizzeriaName={t.pizzeria.name} role={t.role} canRefund={t.role !== "manager" || t.perms.estornar} />;
}
