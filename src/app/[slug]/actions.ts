"use server";

import { loadMenu } from "@/lib/menu";
import { firstIssue, siteOrderSchema, type QuoteInput, type SiteOrderInput } from "@/lib/order-schema";
import { quoteFor, submitOrder, type QuoteResult, type SubmitResult } from "@/lib/orders";
import { adminClient } from "@/lib/supabase/admin";

export async function quoteSiteOrder(slug: string, input: QuoteInput): Promise<QuoteResult> {
  return quoteFor({ slug }, input, "site");
}

export async function placeSiteOrder(input: SiteOrderInput): Promise<SubmitResult> {
  const parsed = siteOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const data = parsed.data;
  if (data.website) return { ok: false, error: "Não foi possível registrar o pedido." };
  const menu = await loadMenu(adminClient(), { slug: data.slug });
  if (!menu) return { ok: false, error: "Loja não encontrada" };
  return submitOrder(menu, data, "site", null);
}
