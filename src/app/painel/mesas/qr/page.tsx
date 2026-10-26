import type { Metadata } from "next";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { allowed, getTenant } from "@/lib/tenant";
import { NoAccess } from "../../no-access";
import { QrSheet } from "./qr-sheet";

export const metadata: Metadata = { title: "QR Codes das mesas" };

export default async function QrPage() {
  const t = (await getTenant())!;
  if (!allowed(t, "configuracoes")) return <NoAccess />;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const { data } = await (await createClient()).from("dining_tables").select("id, name, area, sort, qr_token").eq("pizzeria_id", t.pizzeria.id).eq("active", true);
  const tables = ((data ?? []) as { id: string; name: string; area: string; sort: number; qr_token: string }[]).sort(
    (a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "pt-BR", { numeric: true }),
  );
  return <QrSheet storeName={t.pizzeria.name} tables={tables.map((m) => ({ id: m.id, name: m.name, url: `${origin}/mesa/${m.qr_token}` }))} />;
}
