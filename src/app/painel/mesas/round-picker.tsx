"use client";

import { useState } from "react";
import { ArrowLeft, ChefHat, Minus, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ProductBuilder } from "@/components/store/product-builder";
import { Drawer, Empty, Spinner } from "@/components/ui";
import { toLines, type CartItem } from "@/lib/cart";
import { brl } from "@/lib/money";
import { sellable, startingPrice } from "@/lib/pricing";
import { idempotencyKey } from "@/lib/use-quote";
import type { Menu, Product } from "@/lib/types";
import { placeRound } from "./actions";

/** Lançar uma rodada: escolhe os itens (mesmo montador do PDV) e manda para a cozinha. */
export function RoundPicker({ menu, tabId, tableName, onClose, onSent }: { menu: Menu; tabId: string; tableName: string; onClose: () => void; onSent: () => void }) {
  const [cat, setCat] = useState("todas");
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);

  const products = menu.products.filter(
    (p) => sellable(p) && startingPrice(p, menu.prices) != null && (cat === "todas" || p.category_id === cat) && p.name.toLowerCase().includes(q.toLowerCase()),
  );
  const add = (i: Omit<CartItem, "key">) => setCart((s) => [...s, { ...i, key: crypto.randomUUID() }]);
  const quick = (p: Product) => {
    if (p.is_pizza || menu.extras.some((e) => e.available && !e.pizza_only)) return setPicking(p);
    add({ product_id: p.id, size_id: null, extra_ids: [], qty: 1, note: null, name: p.name, detail: "", image_url: p.image_url, preview_unit_cents: p.price_cents });
  };
  const setQty = (key: string, qty: number) => setCart((s) => (qty <= 0 ? s.filter((i) => i.key !== key) : s.map((i) => (i.key === key ? { ...i, qty: Math.min(50, qty) } : i))));
  const preview = cart.reduce((s, i) => s + i.preview_unit_cents * i.qty, 0);

  const send = async () => {
    if (!cart.length || sending) return;
    setSending(true);
    try {
      const r = await placeRound({ tab_id: tabId, idempotency_key: idempotencyKey(`mesa:${tabId}`), items: toLines(cart), notes });
      if (!r.ok) return void toast.error(r.error);
      idempotencyKey(`mesa:${tabId}`, true);
      toast.success(`Rodada #${r.number} da Mesa ${tableName} enviada para a cozinha`);
      onSent();
    } catch {
      toast.error("Sem conexão. Tente de novo: a mesma rodada não será duplicada.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Drawer title={picking ? picking.name : `Lançar na Mesa ${tableName}`} onClose={onClose} wide>
      {picking ? (
        <div className="space-y-3">
          <button className="flex items-center gap-1 text-sm font-bold text-muted" onClick={() => setPicking(null)}>
            <ArrowLeft className="h-4 w-4" /> Voltar aos produtos
          </button>
          <ProductBuilder
            menu={menu}
            product={picking}
            onAdd={(i) => {
              add(i);
              setPicking(null);
            }}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <label className="relative block">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <input autoFocus className="field !pl-9" placeholder="Buscar produto" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button data-active={cat === "todas"} onClick={() => setCat("todas")} className="chip shrink-0">
              Todas
            </button>
            {menu.categories.map((c) => (
              <button key={c.id} data-active={cat === c.id} onClick={() => setCat(c.id)} className="chip shrink-0">
                {c.name}
              </button>
            ))}
          </div>
          {products.length === 0 ? (
            <Empty>Nenhum produto encontrado.</Empty>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {products.map((p) => (
                <button key={p.id} onClick={() => quick(p)} className="card p-3 text-left transition hover:-translate-y-0.5">
                  <p className="line-clamp-2 text-sm font-bold">{p.name}</p>
                  <p className="mt-1 text-xs text-muted">
                    {p.is_pizza ? "a partir de " : ""}
                    {brl(startingPrice(p, menu.prices)!)}
                  </p>
                </button>
              ))}
            </div>
          )}

          <div className="sticky bottom-0 space-y-2 rounded-2xl border bg-surface p-3 shadow-lg">
            <p className="text-sm font-bold">Rodada ({cart.reduce((s, i) => s + i.qty, 0)} itens)</p>
            {cart.length === 0 ? (
              <p className="text-xs text-muted">Toque nos produtos para adicionar.</p>
            ) : (
              <ul className="max-h-48 space-y-1.5 overflow-y-auto">
                {cart.map((i) => (
                  <li key={i.key} className="flex items-center gap-2 rounded-xl bg-sand/60 p-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{i.name}</p>
                      {i.detail && <p className="truncate text-[11px] text-muted">{i.detail}</p>}
                    </div>
                    <button aria-label="Diminuir" onClick={() => setQty(i.key, i.qty - 1)} className="grid h-7 w-7 place-items-center rounded-full bg-surface">
                      {i.qty === 1 ? <Trash2 className="h-3.5 w-3.5 text-danger" /> : <Minus className="h-3.5 w-3.5" />}
                    </button>
                    <span className="w-5 text-center font-bold">{i.qty}</span>
                    <button aria-label="Aumentar" onClick={() => setQty(i.key, i.qty + 1)} className="grid h-7 w-7 place-items-center rounded-full bg-surface">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input className="field !py-2 text-sm" placeholder="Observação para a cozinha (opcional)" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button className="btn w-full !py-3" disabled={!cart.length || sending} onClick={send}>
              {sending ? <Spinner className="h-4 w-4" /> : <ChefHat className="h-4 w-4" />} Enviar para a cozinha{cart.length ? ` · ~${brl(preview)}` : ""}
            </button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
