import type { Metadata } from "next";
import { loadMenu } from "@/lib/menu";
import { createClient } from "@/lib/supabase/server";
import { can, getTenant } from "@/lib/tenant";
import { NoAccess } from "../no-access";
import { PdvScreen } from "./pdv-screen";

export const metadata: Metadata = { title: "PDV" };

export default async function PdvPage() {
  const t = (await getTenant())!;
  if (!can(t.role, "pdv")) return <NoAccess />;
  const menu = await loadMenu(await createClient(), { id: t.pizzeria.id });
  return <PdvScreen menu={menu!} canReceive={t.role !== "attendant"} />;
}
