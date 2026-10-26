"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { COUNTER_COOKIE, readCounterCookie } from "@/lib/counter";
import { STORE_KINDS, STORE_TEMPLATES, type StoreKind } from "@/lib/store-templates";
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
  name: z.string().trim().min(2, "Informe o nome da loja").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "Use de 3 a 40 letras minúsculas, números ou hífen"),
  kind: z.enum(STORE_KINDS as [StoreKind, ...StoreKind[]]).default("outro"),
});

export async function createPizzeria(input: { name: string; slug: string; kind?: StoreKind }): Promise<{ ok: false; error: string } | undefined> {
  const parsed = newStore.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const sb = await createClient();
  const { data, error } = await sb.rpc("create_pizzeria", { _name: parsed.data.name, _slug: parsed.data.slug });
  if (error) return { ok: false, error: error.message.length < 120 ? error.message : "Não foi possível criar a loja." };
  await applyTemplate(sb, data as string, parsed.data.kind);
  (await cookies()).set(TENANT_COOKIE, data as string, { path: "/painel", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  redirect("/painel");
}

/**
 * A loja nasce (no banco) com o cardápio de pizzaria. Para outros negócios, troca pelas categorias
 * e tamanhos do modelo escolhido. A loja acabou de ser criada e não tem produtos, então é seguro apagar.
 * Se algo falhar aqui, a loja continua criada com o modelo padrão (dá para editar no Cardápio).
 */
async function applyTemplate(sb: Awaited<ReturnType<typeof createClient>>, pizzeriaId: string, kind: StoreKind) {
  if (kind === "pizzaria") return;
  const t = STORE_TEMPLATES[kind];
  try {
    await sb.from("sizes").delete().eq("pizzeria_id", pizzeriaId);
    await sb.from("categories").delete().eq("pizzeria_id", pizzeriaId);
    await sb.from("categories").insert(t.categories.map((name, i) => ({ pizzeria_id: pizzeriaId, name, sort: i + 1 })));
    if (t.sizes.length) await sb.from("sizes").insert(t.sizes.map((x, i) => ({ pizzeria_id: pizzeriaId, ...x, sort: i + 1 })));
  } catch (e) {
    console.error("modelo da loja não aplicado", (e as Error).message);
  }
}
