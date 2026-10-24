import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { createClient, getUser } from "./supabase/server";
import type { Pizzeria, Role } from "./types";

export const TENANT_COOKIE = "pav-loja";
export type Membership = { pizzeria: Pizzeria; role: Role };

/** O que cada função vê no painel. O banco aplica as mesmas regras de verdade. */
export const ACCESS = {
  pedidos: ["owner", "manager", "cashier", "attendant", "kitchen", "driver"],
  cozinha: ["owner", "manager", "cashier", "kitchen"],
  entregas: ["owner", "manager", "cashier", "attendant", "driver"],
  pdv: ["owner", "manager", "cashier", "attendant"],
  cardapio: ["owner", "manager"],
  configuracoes: ["owner", "manager"],
  cupons: ["owner", "manager"],
  equipe: ["owner"],
  automacoes: ["owner", "manager"],
} as const satisfies Record<string, readonly Role[]>;

export const can = (role: Role, area: keyof typeof ACCESS) => (ACCESS[area] as readonly Role[]).includes(role);

export const getMemberships = cache(async (): Promise<Membership[]> => {
  const user = await getUser();
  if (!user) return [];
  const sb = await createClient();
  const { data, error } = await sb.from("members").select("role, pizzeria:pizzerias(*)").eq("user_id", user.id).order("created_at");
  if (error) throw new Error("Não foi possível carregar suas pizzarias");
  return (data as unknown as { role: Role; pizzeria: Pizzeria | null }[]).filter((m) => m.pizzeria).map((m) => ({ role: m.role, pizzeria: m.pizzeria! }));
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
