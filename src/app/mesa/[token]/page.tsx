import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { loadMenu } from "@/lib/menu";
import { tableByToken } from "@/lib/mesa-qr";
import { adminClient } from "@/lib/supabase/admin";
import { supabaseConfigured } from "@/lib/supabase/env";
import { GuestTable } from "./guest-table";

export const metadata: Metadata = { title: "Cardápio da mesa", robots: { index: false, follow: false } };

export default async function MesaPage({ params }: PageProps<"/mesa/[token]">) {
  if (!supabaseConfigured) return <SetupNotice />;
  const { token } = await params;
  const t = await tableByToken(token);
  if (!t) notFound();
  const menu = await loadMenu(adminClient(), { id: t.pizzeria_id });
  if (!menu) notFound();
  return <GuestTable token={token} tableName={t.name} active={t.active} menu={menu} canOrder={menu.pizzeria.qr_ordering !== false} />;
}
