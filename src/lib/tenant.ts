import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { createClient, getUser } from "./supabase/server";
import { areaAllowed, DEFAULT_MANAGER_PERMS, FULL_PERMS, type ManagerPerms } from "./permissions";
import type { Pizzeria, Role } from "./types";

export const TENANT_COOKIE = "pav-loja";
export type Membership = { pizzeria: Pizzeria; role: Role; perms: ManagerPerms };

/** O que cada função vê no painel. O banco aplica as mesmas regras de verdade. */
export const ACCESS = {
  pedidos: ["owner", "manager", "cashier", "attendant"],
  cozinha: ["owner", "manager", "cashier", "kitchen"],
  entregas: ["owner", "manager", "cashier", "attendant"],
  entregador: ["driver"],
  pdv: ["owner", "manager", "cashier", "attendant"],
  caixa: ["owner", "manager", "cashier"],
  cardapio: ["owner", "manager"],
  configuracoes: ["owner", "manager"],
  cupons: ["owner", "manager"],
  equipe: ["owner", "manager"],
  automacoes: ["owner", "manager"],
} as const satisfies Record<string, readonly Role[]>;

export const can = (role: Role, area: keyof typeof ACCESS) => (ACCESS[area] as readonly Role[]).includes(role);

/** Como `can`, mas para o gerente também confere o que o dono liberou. */
export const allowed = (t: Membership, area: keyof typeof ACCESS) => areaAllowed(t.role, t.perms, area, ACCESS);
/** Permissão extra do gerente (estornar, ver faturamento). Dono sempre pode. */
export const allowedPerm = (t: Membership, p: keyof ManagerPerms) => t.role === "owner" || (t.role === "manager" && t.perms[p]);

export const getMemberships = cache(async (): Promise<Membership[]> => {
  const user = await getUser();
  if (!user) return [];
  const sb = await createClient();
  const { data, error } = await sb.from("members").select("role, pizzeria:pizzerias(*)").eq("user_id", user.id).order("created_at");
  if (error) throw new Error("Não foi possível carregar suas pizzarias");
  const list = (data as unknown as { role: Role; pizzeria: Pizzeria | null }[]).filter((m) => m.pizzeria);
  // Permissões do gerente (sem a migração, valem as de antes).
  const managed = list.filter((m) => m.role === "manager").map((m) => m.pizzeria!.id);
  const settings = managed.length ? (await sb.from("manager_settings").select("*").in("pizzeria_id", managed)).data ?? [] : [];
  const byPz = new Map((settings as (ManagerPerms & { pizzeria_id: string })[]).map((s) => [s.pizzeria_id, s]));
  return list.map((m) => {
    const s = byPz.get(m.pizzeria!.id);
    const perms: ManagerPerms = m.role === "owner" ? FULL_PERMS : s ? { cardapio: s.cardapio, cupons: s.cupons, configuracoes: s.configuracoes, automacoes: s.automacoes, estornar: s.estornar, faturamento: s.faturamento, equipe: s.equipe } : DEFAULT_MANAGER_PERMS;
    return { role: m.role, pizzeria: m.pizzeria!, perms };
  });
});

/** Pizzaria escolhida no seletor (ou a primeira). */
export const getTenant = cache(async (): Promise<Membership | null> => {
  const list = await getMemberships();
  const chosen = (await cookies()).get(TENANT_COOKIE)?.value;
  return list.find((m) => m.pizzeria.id === chosen) ?? list[0] ?? null;
});

/** Confere no banco se o usuário logado tem uma das funções nesta pizzaria. */
export async function hasRole(pizzeriaId: string, roles: readonly Role[]) {
  const sb = await createClient();
  const { data, error } = await sb.rpc("has_role", { _pz: pizzeriaId, _roles: roles });
  return !error && data === true;
}

/** Início do dia de hoje em São Paulo (Brasil sem horário de verão: UTC−3). */
export function startOfTodaySP(): Date {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return new Date(`${day}T00:00:00-03:00`);
}
