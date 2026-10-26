import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { allowed, getTenant } from "@/lib/tenant";
import type { Coupon } from "@/lib/types";
import { NoAccess } from "../no-access";
import { CouponsManager } from "./coupons-manager";
import { LoyaltyPanel, type LoyaltyProgram } from "./loyalty-panel";

export const metadata: Metadata = { title: "Cupons" };

export default async function CuponsPage() {
  const t = (await getTenant())!;
  if (!allowed(t, "cupons")) return <NoAccess />;
  const sb = await createClient();
  const [{ data }, loyalty] = await Promise.all([
    sb.from("coupons").select("*").eq("pizzeria_id", t.pizzeria.id).order("created_at", { ascending: false }),
    sb.from("loyalty_programs").select("*").eq("pizzeria_id", t.pizzeria.id).maybeSingle(),
  ]);
  const all = (data ?? []) as Coupon[];
  // Cupons pessoais (prêmios) não entram na lista principal: são muitos e cada um é de um cliente.
  const personal = all.filter((c) => c.customer_id);
  const live = personal.filter((c) => c.active && (c.max_uses == null || c.uses < c.max_uses) && (!c.ends_at || new Date(c.ends_at) > new Date()));
  return (
    <>
      <CouponsManager pizzeriaId={t.pizzeria.id} coupons={all.filter((c) => !c.customer_id)} personal={{ active: live.length, used: personal.filter((c) => c.uses > 0).length }} />
      <LoyaltyPanel pizzeriaId={t.pizzeria.id} program={loyalty.error ? undefined : ((loyalty.data as LoyaltyProgram | null) ?? null)} />
    </>
  );
}
