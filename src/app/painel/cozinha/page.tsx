import type { Metadata } from "next";
import { can, getTenant } from "@/lib/tenant";
import { NoAccess } from "../no-access";
import { PanelKitchen } from "./kitchen-board";

export const metadata: Metadata = { title: "Cozinha" };

export default async function CozinhaPage() {
  const t = (await getTenant())!;
  if (!can(t.role, "cozinha")) return <NoAccess />;
  return <PanelKitchen pizzeriaId={t.pizzeria.id} prepMinutes={t.pizzeria.prep_minutes} />;
}
