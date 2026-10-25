"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { COUNTER_COOKIE, readCounterCookie } from "@/lib/counter";
import { getMemberships, TENANT_COOKIE } from "@/lib/tenant";

export async function switchPizzeria(id: string) {
  const list = await getMemberships();
  if (!list.some((m) => m.pizzeria.id === id)) return;
  (await cookies()).set(TENANT_COOKIE, id, { path: "/painel", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  redirect("/painel");
}

export async function signOut() {
  const sb = await createClient();
  await sb.auth.signOut();
  (await cookies()).delete(COUNTER_COOKIE);
  redirect("/entrar");
}

/** Computador do balcão: sai da pessoa atual e volta para a lista da equipe. */
export async function switchCounterUser() {
  const store = await cookies();
  const counter = readCounterCookie(store.get(COUNTER_COOKIE)?.value);
  const sb = await createClient();
  await sb.auth.signOut();
  redirect(counter ? `/balcao/${counter.code}` : "/entrar");
}

const newStore = z.object({
  name: z.string().trim().min(2, "Informe o nome da pizzaria").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "Use de 3 a 40 letras minúsculas, números ou hífen"),
});

export async function createPizzeria(input: { name: string; slug: string }): Promise<{ ok: false; error: string } | undefined> {
  const parsed = newStore.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const sb = await createClient();
  const { data, error } = await sb.rpc("create_pizzeria", { _name: parsed.data.name, _slug: parsed.data.slug });
  if (error) return { ok: false, error: error.message.length < 120 ? error.message : "Não foi possível criar a pizzaria." };
  (await cookies()).set(TENANT_COOKIE, data as string, { path: "/painel", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  redirect("/painel");
}
