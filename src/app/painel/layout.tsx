import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient, getUser } from "@/lib/supabase/server";
import { ACCESS, getMemberships, getTenant } from "@/lib/tenant";
import { Onboarding } from "./onboarding";
import { Shell } from "./shell";
import { WaitingApproval } from "./waiting-approval";

export const metadata: Metadata = { title: { default: "Painel", template: "%s · Painel" }, robots: { index: false } };

export default async function PainelLayout({ children }: LayoutProps<"/painel">) {
  if (!supabaseConfigured) return <SetupNotice />;
  const user = await getUser();
  if (!user) redirect("/entrar?next=/painel");
  const list = await getMemberships();
  const tenant = await getTenant();
  if (!tenant) {
    const sb = await createClient();
    const { data } = await sb.from("join_requests").select("pizzeria:pizzerias(name)").eq("user_id", user.id).eq("status", "pendente");
    const waiting = ((data ?? []) as unknown as { pizzeria: { name: string } | null }[]).flatMap((r) => (r.pizzeria ? [r.pizzeria.name] : []));
    if (waiting.length) return <WaitingApproval email={user.email} pizzerias={waiting} />;
    return <Onboarding email={user.email} />;
  }
  return (
    <Shell
      email={user.email}
      role={tenant.role}
      pizzeria={{ id: tenant.pizzeria.id, name: tenant.pizzeria.name, slug: tenant.pizzeria.slug, accepting: tenant.pizzeria.accepting_orders }}
      stores={list.map((m) => ({ id: m.pizzeria.id, name: m.pizzeria.name }))}
      access={ACCESS}
    >
      {children}
    </Shell>
  );
}
