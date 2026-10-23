import type { Metadata } from "next";
import { createClient, getUser } from "@/lib/supabase/server";
import { can, getTenant } from "@/lib/tenant";
import type { Role } from "@/lib/types";
import { NoAccess } from "../no-access";
import { TeamManager, type Member } from "./team-manager";

export const metadata: Metadata = { title: "Equipe" };

export default async function EquipePage() {
  const t = (await getTenant())!;
  if (!can(t.role, "equipe")) return <NoAccess />;
  const [sb, user] = await Promise.all([createClient(), getUser()]);
  const { data } = await sb.from("members").select("user_id, role, display_name, created_at").eq("pizzeria_id", t.pizzeria.id).order("created_at");
  const members = ((data ?? []) as { user_id: string; role: Role; display_name: string | null; created_at: string }[]).map<Member>((m) => ({
    ...m,
    is_me: m.user_id === user?.id,
  }));
  return <TeamManager pizzeriaId={t.pizzeria.id} members={members} />;
}
