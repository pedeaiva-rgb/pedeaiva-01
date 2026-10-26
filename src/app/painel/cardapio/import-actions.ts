"use server";

import { generateText, Output } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ACCESS, hasRole } from "@/lib/tenant";

// Liberado no plano gratuito do AI Gateway; com créditos pagos dá para trocar por "anthropic/claude-haiku-5.5".
const MODEL = "google/gemini-2.5-flash";

/** O que a IA devolve: só leitura da lista, sem inventar preço. */
const aiSchema = z.object({
  items: z.array(
    z.object({
      kind: z.enum(["pizza", "item", "extra"]).describe("pizza = produto com preço por tamanho (pizza, açaí, marmita P/M/G...); item = preço único (lanche, prato, bebida, sobremesa, entrada); extra = adicional ou borda"),
      category: z.string().describe("Categoria do cardápio (ex.: Lanches, Pizzas, Pratos, Bebidas, Sobremesas). Para extra, use \"Adicionais\"."),
      name: z.string(),
      description: z.string().describe("Ingredientes ou detalhes, se houver; senão string vazia"),
      price: z.number().nullable().describe("Preço em reais para item ou extra; null se não estiver escrito"),
      prices: z.array(z.object({ size: z.string(), price: z.number() })).describe("Para produto por tamanho: preço em reais em cada tamanho; vazio nos outros"),
      pizza_only: z.boolean().describe("Para extra: true se só vale para produtos por tamanho (bordas, coberturas)"),
    }),
  ),
});

export type ImportRow = {
  kind: "pizza" | "item" | "extra";
  category: string;
  name: string;
  description: string;
  price_cents: number | null;
  prices: { size_id: string; size: string; price_cents: number }[];
  pizza_only: boolean;
  /** Avisos para a pessoa conferir antes de cadastrar. */
  warnings: string[];
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const cents = (reais: number) => Math.round(reais * 100);
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Lê a lista colada e devolve uma prévia. Nada é gravado aqui. */
export async function parseMenuText(pizzeriaId: string, text: string): Promise<Result<ImportRow[]>> {
  if (!(await hasRole(pizzeriaId, ACCESS.cardapio))) return { ok: false, error: "Você não tem permissão para editar o cardápio." };
  const clean = text.trim();
  if (clean.length < 10) return { ok: false, error: "Cole a lista do cardápio para a IA ler." };
  if (clean.length > 20_000) return { ok: false, error: "Lista grande demais. Envie em partes de até 20 mil caracteres." };

  const sb = await createClient();
  const { data: sizes } = await sb.from("sizes").select("id,name").eq("pizzeria_id", pizzeriaId).order("sort");
  const sizeList = (sizes ?? []) as { id: string; name: string }[];

  let output: z.infer<typeof aiSchema>;
  try {
    const r = await generateText({
      model: MODEL,
      output: Output.object({ schema: aiSchema }),
      system: [
        "Você lê cardápios de restaurantes, lanchonetes, pizzarias e deliveries em português do Brasil e transforma em itens estruturados.",
        "Regras: nunca invente preço; se um preço não estiver escrito, use null (ou deixe o tamanho de fora).",
        "Preços em reais, com vírgula decimal convertida para número (42,90 → 42.9).",
        `Os tamanhos desta loja (para produtos por tamanho) são: ${sizeList.map((s) => s.name).join(", ") || "(nenhum)"}. Use exatamente esses nomes no campo size.`,
        "Ignore títulos, observações e linhas que não sejam produtos.",
      ].join("\n"),
      prompt: clean,
    });
    output = r.output;
  } catch (e) {
    console.error("IA do cardápio falhou", e);
    const msg = String((e as Error)?.message ?? "");
    if (/credit card/i.test(msg)) return { ok: false, error: "Para usar a IA, cadastre um cartão na Vercel (AI Gateway). Isso libera os créditos gratuitos." };
    if (/credit|billing|payment|402/i.test(msg)) return { ok: false, error: "A IA está sem créditos na Vercel. Adicione créditos ao AI Gateway e tente de novo." };
    if (/auth|401|403|oidc|token/i.test(msg)) return { ok: false, error: "A IA não está autorizada. Confira o AI Gateway no projeto da Vercel." };
    return { ok: false, error: "A IA não conseguiu ler a lista agora. Tente de novo em instantes." };
  }

  const bySize = new Map(sizeList.map((s) => [norm(s.name), s]));
  const rows: ImportRow[] = output.items
    .filter((it) => it.name.trim())
    .map((it) => {
      const warnings: string[] = [];
      const prices: ImportRow["prices"] = [];
      if (it.kind === "pizza") {
        for (const p of it.prices) {
          const s = bySize.get(norm(p.size));
          if (!s) warnings.push(`Tamanho "${p.size}" não existe na loja`);
          else if (p.price > 0) prices.push({ size_id: s.id, size: s.name, price_cents: cents(p.price) });
        }
        if (prices.length === 0) warnings.push("Sem preço em nenhum tamanho");
      } else if (it.price == null || it.price <= 0) warnings.push("Sem preço");
      return {
        kind: it.kind,
        category: (it.kind === "extra" ? "Adicionais" : it.category.trim() || "Outros").slice(0, 60),
        name: it.name.trim().slice(0, it.kind === "extra" ? 60 : 80),
        description: it.description.trim().slice(0, 400),
        price_cents: it.kind === "pizza" || it.price == null ? null : cents(it.price),
        prices,
        pizza_only: it.kind === "extra" ? it.pizza_only : false,
        warnings,
      };
    });
  if (rows.length === 0) return { ok: false, error: "A IA não encontrou produtos nessa lista." };
  return { ok: true, data: rows };
}

/** Cadastra os itens conferidos. Produto com o mesmo nome é atualizado em vez de duplicado. */
export async function importMenuItems(pizzeriaId: string, rows: ImportRow[]): Promise<Result<{ created: number; updated: number; skipped: string[] }>> {
  if (!(await hasRole(pizzeriaId, ACCESS.cardapio))) return { ok: false, error: "Você não tem permissão para editar o cardápio." };
  const sb = await createClient();
  const [cats, prods, extras] = await Promise.all([
    sb.from("categories").select("id,name,sort").eq("pizzeria_id", pizzeriaId),
    sb.from("products").select("id,name").eq("pizzeria_id", pizzeriaId),
    sb.from("extras").select("id,name").eq("pizzeria_id", pizzeriaId),
  ]);
  const catMap = new Map(((cats.data ?? []) as { id: string; name: string }[]).map((c) => [norm(c.name), c.id]));
  const prodMap = new Map(((prods.data ?? []) as { id: string; name: string }[]).map((p) => [norm(p.name), p.id]));
  const extraMap = new Map(((extras.data ?? []) as { id: string; name: string }[]).map((x) => [norm(x.name), x.id]));
  let nextSort = (cats.data ?? []).length + 1;
  let created = 0;
  let updated = 0;
  const skipped: string[] = [];

  const categoryId = async (name: string) => {
    const key = norm(name);
    const hit = catMap.get(key);
    if (hit) return hit;
    const { data, error } = await sb.from("categories").insert({ pizzeria_id: pizzeriaId, name, sort: nextSort++ }).select("id").single();
    if (error) return null;
    catMap.set(key, data.id as string);
    return data.id as string;
  };

  for (const r of rows) {
    if (r.kind === "extra") {
      if (r.price_cents == null) {
        skipped.push(`${r.name} (sem preço)`);
        continue;
      }
      const existing = extraMap.get(norm(r.name));
      const res = existing
        ? await sb.from("extras").update({ price_cents: r.price_cents, pizza_only: r.pizza_only }).eq("id", existing)
        : await sb.from("extras").insert({ pizzeria_id: pizzeriaId, name: r.name, price_cents: r.price_cents, pizza_only: r.pizza_only });
      if (res.error) skipped.push(`${r.name} (erro ao salvar)`);
      else if (existing) updated++;
      else created++;
      continue;
    }

    if ((r.kind === "pizza" && r.prices.length === 0) || (r.kind === "item" && r.price_cents == null)) {
      skipped.push(`${r.name} (sem preço)`);
      continue;
    }
    const cat = await categoryId(r.category);
    if (!cat) {
      skipped.push(`${r.name} (categoria não criada)`);
      continue;
    }
    const row = {
      pizzeria_id: pizzeriaId,
      category_id: cat,
      name: r.name,
      description: r.description,
      is_pizza: r.kind === "pizza",
      price_cents: r.kind === "pizza" ? 0 : r.price_cents!,
      archived: false,
    };
    const existing = prodMap.get(norm(r.name));
    const res = existing
      ? await sb.from("products").update(row).eq("id", existing).select("id").single()
      : await sb.from("products").insert(row).select("id").single();
    if (res.error) {
      skipped.push(`${r.name} (erro ao salvar)`);
      continue;
    }
    const id = res.data.id as string;
    prodMap.set(norm(r.name), id);
    if (r.kind === "pizza") {
      const up = await sb
        .from("product_prices")
        .upsert(r.prices.map((p) => ({ pizzeria_id: pizzeriaId, product_id: id, size_id: p.size_id, price_cents: p.price_cents })));
      if (up.error) skipped.push(`${r.name} (preços não salvos)`);
    }
    if (existing) updated++;
    else created++;
  }
  return { ok: true, data: { created, updated, skipped } };
}
