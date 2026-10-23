import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicClient } from "./supabase/server";
import type { Menu } from "./types";

/** Cardápio completo de uma pizzaria. `includeHidden` traz também o que está pausado (painel). */
export async function loadMenu(sb: SupabaseClient, by: { slug: string } | { id: string }, includeHidden = false): Promise<Menu | null> {
  const q = sb.from("pizzerias").select("*");
  const { data: pizzeria, error } = await ("slug" in by ? q.eq("slug", by.slug) : q.eq("id", by.id)).maybeSingle();
  if (error) throw new Error("Não foi possível carregar a loja");
  if (!pizzeria) return null;
  const id = pizzeria.id as string;
  const [c, s, p, pr, e, z] = await Promise.all([
    sb.from("categories").select("*").eq("pizzeria_id", id).order("sort").order("name"),
    sb.from("sizes").select("*").eq("pizzeria_id", id).order("sort"),
    sb.from("products").select("*").eq("pizzeria_id", id).eq("archived", false).order("sort").order("name"),
    sb.from("product_prices").select("*").eq("pizzeria_id", id),
    sb.from("extras").select("*").eq("pizzeria_id", id).order("sort").order("name"),
    sb.from("delivery_zones").select("*").eq("pizzeria_id", id).order("name"),
  ]);
  const failed = [c, s, p, pr, e, z].find((r) => r.error);
  if (failed) throw new Error("Não foi possível carregar o cardápio");
  const menu: Menu = {
    pizzeria,
    categories: c.data!,
    sizes: s.data!,
    products: p.data!,
    prices: pr.data!,
    extras: e.data!,
    zones: z.data!,
  };
  if (includeHidden) return menu;
  return {
    ...menu,
    categories: menu.categories.filter((x) => x.active),
    sizes: menu.sizes.filter((x) => x.active),
    extras: menu.extras.filter((x) => x.available),
    zones: menu.zones.filter((x) => x.active),
  };
}

/** Vitrine pública (uma consulta por requisição). */
export const getStoreMenu = cache((slug: string) => loadMenu(publicClient(), { slug }));
