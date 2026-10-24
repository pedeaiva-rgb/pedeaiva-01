import type { Metadata } from "next";
import { headers } from "next/headers";
import { createClient, getUser } from "@/lib/supabase/server";
import { can, getTenant } from "@/lib/tenant";
import type { Role } from "@/lib/types";
import { NoAccess } from "../no-access";
import { TeamManager, type JoinRequest, type Member } from "./team-manager";

export const metadata: Metadata = { title: "Equipe" };

export default async function EquipePage() {
  const t = (await getTenant())!;
  if (!can(t.role, "equipe")) return <NoAccess />;
  const [sb, user, h] = await Promise.all([createClient(), getUser(), headers()]);
  const pz = t.pizzeria.id;
  const [{ data }, invite, reqs] = await Promise.all([
    sb.from("members").select("user_id, role, display_name, created_at").eq("pizzeria_id", pz).order("created_at"),
    sb.rpc("team_invite", { _pz: pz }),
    sb.from("join_requests").select("id, user_id, full_name, email, cpf, phone, status, created_at").eq("pizzeria_id", pz).order("created_at", { ascending: false }),
  ]);
  const requests = (reqs.data ?? []) as JoinRequest[];
  const byUser = new Map(requests.filter((r) => r.status === "aprovado").map((r) => [r.user_id, r]));
  const members = ((data ?? []) as { user_id: string; role: Role; display_name: string | null; created_at: string }[]).map<Member>((m) => ({
    ...m,
    is_me: m.user_id === user?.id,
    phone: byUser.get(m.user_id)?.phone ?? null,
    email: byUser.get(m.user_id)?.email ?? null,
  }));
  // Sem a migração de convites rodada, a função ainda não existe.
  const inviteRow = (invite.data as { code: string; active: boolean }[] | null)?.[0] ?? null;
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  return (
    <TeamManager
      pizzeriaId={pz}
      pizzeriaName={t.pizzeria.name}
      members={members}
      pending={requests.filter((r) => r.status === "pendente")}
      invite={inviteRow ? { ...inviteRow, url: `${origin}/convite/${inviteRow.code}` } : null}
      missingMigration={!!invite.error}
    />
  );
}
