"use client";

import { useEffect, useState } from "react";
import { History, MapPin, UserRound } from "lucide-react";
import type { CartItem } from "@/lib/cart";
import { brl } from "@/lib/money";
import { normalizeBrPhone } from "@/lib/phone";
import { sellable } from "@/lib/pricing";
import { browserClient } from "@/lib/supabase/client";
import type { Address, Menu, OrderItem } from "@/lib/types";

type PastOrder = {
  id: string;
  number: number;
  created_at: string;
  customer_name: string;
  address: Address | null;
  total_cents: number;
  order_items: Pick<OrderItem, "product_id" | "size_id" | "flavors" | "extras" | "qty" | "note" | "name" | "size_name" | "unit_price_cents">[];
};
type Found = { name: string | null; count: number; last: PastOrder | null };

/** Itens do pedido antigo que ainda estão à venda, no formato da sacola (o preço é recalculado no servidor). */
export function repeatItems(menu: Menu, o: PastOrder): CartItem[] {
  return o.order_items.flatMap((i) => {
    const p = menu.products.find((x) => x.id === i.product_id);
    if (!p || !sellable(p)) return [];
    if (i.size_id && !menu.sizes.some((s) => s.id === i.size_id && s.active)) return [];
    const extras = i.extras.filter((e) => menu.extras.some((x) => x.id === e.id && x.available));
    const flavors = i.flavors.filter((f) => menu.products.some((x) => x.id === f.product_id && sellable(x)));
    if (i.flavors.length > 1 && flavors.length !== i.flavors.length) return [];
    const detail = [i.size_name, flavors.length > 1 ? flavors.map((f) => f.name).join(" + ") : "", extras.length ? `+ ${extras.map((e) => e.name).join(", ")}` : ""].filter(Boolean).join(" · ");
    return [
      {
        key: crypto.randomUUID(),
        product_id: p.id,
        size_id: i.size_id,
        flavor_ids: flavors.length > 1 ? flavors.map((f) => f.product_id) : undefined,
        extra_ids: extras.map((e) => e.id),
        qty: i.qty,
        note: i.note,
        name: flavors.length > 1 ? "Meio a meio" : i.name,
        detail,
        image_url: p.image_url,
        preview_unit_cents: i.unit_price_cents,
      },
    ];
  });
}

/**
 * Telefone digitado no PDV → mostra se o cliente já pediu antes, com o nome, o último endereço
 * e o botão de repetir o último pedido (agiliza pedido por telefone).
 */
export function CustomerLookup({
  menu,
  phone,
  onUseData,
  onRepeat,
}: {
  menu: Menu;
  phone: string;
  onUseData: (name: string | null, address: Address | null) => void;
  onRepeat: (items: CartItem[]) => void;
}) {
  const digits = normalizeBrPhone(phone);
  const [found, setFound] = useState<{ phone: string; data: Found } | null>(null);

  useEffect(() => {
    if (!digits) return;
    let alive = true;
    const sb = browserClient();
    const pz = menu.pizzeria.id;
    const t = setTimeout(async () => {
      const [c, o, n] = await Promise.all([
        sb.from("customers").select("name").eq("pizzeria_id", pz).eq("phone", digits).maybeSingle(),
        sb
          .from("orders")
          .select("id,number,created_at,customer_name,address,total_cents, order_items(product_id,size_id,flavors,extras,qty,note,name,size_name,unit_price_cents)")
          .eq("pizzeria_id", pz)
          .eq("customer_phone", digits)
          .neq("status", "cancelado")
          .order("created_at", { ascending: false })
          .limit(1),
        sb.from("orders").select("id", { count: "exact", head: true }).eq("pizzeria_id", pz).eq("customer_phone", digits).neq("status", "cancelado"),
      ]);
      if (!alive) return;
      const last = ((o.data ?? []) as PastOrder[])[0] ?? null;
      setFound({ phone: digits, data: { name: (c.data?.name as string | undefined) ?? last?.customer_name ?? null, count: n.count ?? 0, last } });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [digits, menu.pizzeria.id]);

  const data = found && found.phone === digits ? found.data : null;
  if (!digits || !data) return null;
  if (!data.count && !data.name) return <p className="text-xs text-muted">Cliente novo: nenhum pedido com este telefone.</p>;

  const last = data.last;
  const items = last ? repeatItems(menu, last) : [];
  const a = last?.address;
  return (
    <div className="space-y-2 rounded-2xl bg-info-soft p-3 text-xs">
      <p className="flex items-center gap-1.5 font-bold text-info">
        <UserRound className="h-4 w-4" /> {data.name ?? "Cliente"} · {data.count} pedido(s)
        {last ? ` · último em ${new Date(last.created_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}
      </p>
      {a && (
        <p className="flex gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {a.street}, {a.number}
          {a.complement ? ` – ${a.complement}` : ""} — {a.neighborhood}
        </p>
      )}
      {last && (
        <p className="text-muted">
          Último pedido #{last.number}: {last.order_items.map((i) => `${i.qty}× ${i.name}${i.size_name ? ` (${i.size_name})` : ""}`).join(", ")} · {brl(last.total_cents)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost !bg-surface !px-3 !py-1.5 text-xs" onClick={() => onUseData(data.name, a ?? null)}>
          Usar nome{a ? " e endereço" : ""}
        </button>
        {items.length > 0 && (
          <button type="button" className="btn !px-3 !py-1.5 text-xs" onClick={() => onRepeat(items)}>
            <History className="h-3.5 w-3.5" /> Repetir último pedido ({items.reduce((s, i) => s + i.qty, 0)} itens)
          </button>
        )}
      </div>
      {last && items.length < last.order_items.length && <p className="text-[11px] text-warning">Alguns itens do último pedido não estão mais à venda e ficaram de fora.</p>}
    </div>
  );
}
