import type { Metadata } from "next";
import { loadMenu } from "@/lib/menu";
import { createClient } from "@/lib/supabase/server";
import { can, getTenant } from "@/lib/tenant";
import { NoAccess } from "../no-access";
import { MenuManager } from "./menu-manager";

export const metadata: Metadata = { title: "Cardápio" };

export default async function CardapioPage() {
  const t = (await getTenant())!;
  if (!can(t.role, "cardapio")) return <NoAccess />;
  const menu = await loadMenu(await createClient(), { id: t.pizzeria.id }, true);
  return <MenuManager menu={menu!} />;
}
