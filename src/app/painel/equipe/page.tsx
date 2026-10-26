import type { Metadata } from "next";
import { headers } from "next/headers";
import { createClient, getUser } from "@/lib/supabase/server";
import { allowed, getTenant } from "@/lib/tenant";
import { DEFAULT_MANAGER_PERMS, type ManagerPerms } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import { NoAccess } from "../no-access";
import { TeamManager, type JoinRequest, type Member } from "./team-manager";

export const metadata: Metadata = { title: "Equipe" };

export default async function EquipePage() {
  const t = (await getTenant())!;
  if (!allowed(t, "equipe")) return <NoAccess />;
  const [sb, user, h] = await Promise.all([createClient(), getUser(), headers()]);
  const pz = t.pizzeria.id;
  const [{ data }, invite, reqs, pins, settings] = await Promise.all([
    sb.from("members").select("user_id, role, display_name, created_at").eq("pizzeria_id", pz).order("created_at"),
    sb.rpc("team_invite", { _pz: pz }),
    sb.from("join_requests").select("id, user_id, full_name, email, cpf, phone, status, created_at").eq("pizzeria_id", pz).order("created_at", { ascending: false }),
    sb.rpc("team_pins", { _pz: pz }),
    t.role === "owner" ? sb.from("manager_settings").select("*").eq("pizzeria_id", pz).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  // Sem linha ainda = padrão; sem a tabela (migração não rodada) = null.
  const managerPerms: ManagerPerms | null = settings.error ? null : { ...DEFAULT_MANAGER_PERMS, ...((settings.data ?? {}) as Partial<ManagerPerms>) };
  const withPin = new Set(((pins.data ?? []) as { user_id: string; has_pin: boolean }[]).filter((p) => p.has_pin).map((p) => p.user_id));
  const requests = (reqs.data ?? []) as JoinRequest[];
  const byUser = new Map(requests.filter((r) => r.status === "aprovado").map((r) => [r.user_id, r]));
  const members = ((data ?? []) as { user_id: string; role: Role; display_name: string | null; created_at: string }[]).map<Member>((m) => ({
    ...m,
    is_me: m.user_id === user?.id,
    phone: byUser.get(m.user_id)?.phone ?? null,
    email: byUser.get(m.user_id)?.email ?? null,
    // Sem a migração do balcão, fica "desconhecido" (null).
    has_pin: pins.error ? null : withPin.has(m.user_id),
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
      viewer={t.role}
      managerPerms={managerPerms}
    />
  );
}
