import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { allowed, getTenant } from "@/lib/tenant";
import type { Coupon } from "@/lib/types";
import { NoAccess } from "../no-access";
import { CouponsManager } from "./coupons-manager";

export const metadata: Metadata = { title: "Cupons" };

export default async function CuponsPage() {
  const t = (await getTenant())!;
  if (!allowed(t, "cupons")) return <NoAccess />;
  const sb = await createClient();
  const { data } = await sb.from("coupons").select("*").eq("pizzeria_id", t.pizzeria.id).order("created_at", { ascending: false });
  return <CouponsManager pizzeriaId={t.pizzeria.id} coupons={(data ?? []) as Coupon[]} />;
}
