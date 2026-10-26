"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { Bell, Check, ChefHat, Minus, Plus, Receipt, ShoppingBag, Trash2, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { ProductBuilder } from "@/components/store/product-builder";
import { ProductImage } from "@/components/store/product-image";
import { Drawer, Spinner } from "@/components/ui";
import { toLines, type CartItem } from "@/lib/cart";
import { brl } from "@/lib/money";
import { sellable, startingPrice } from "@/lib/pricing";
import { idempotencyKey } from "@/lib/use-quote";
import type { Menu, OrderStatus, Product } from "@/lib/types";
import { callStaff, placeGuestOrder, tableState, type GuestState } from "./actions";

/** Como o cliente lê o andamento de cada pedido. */
const GUEST_STATUS: Record<OrderStatus, { label: string; cls: string }> = {
  novo: { label: "Aguardando a equipe confirmar", cls: "bg-info-soft text-info" },
  confirmado: { label: "Confirmado", cls: "bg-sand text-ink" },
  preparo: { label: "Preparando", cls: "bg-warning-soft text-warning" },
  pronto: { label: "Pronto, já vai chegar", cls: "bg-success-soft text-success" },
  saiu: { label: "A caminho", cls: "bg-success-soft text-success" },
  entregue: { label: "Servido", cls: "bg-success text-paper" },
  cancelado: { label: "Cancelado", cls: "bg-sand text-muted line-through" },
};

export function GuestTable({ token, tableName, active, menu, canOrder }: { token: string; tableName: string; active: boolean; menu: Menu; canOrder: boolean }) {
  const [view, setView] = useState<"cardapio" | "conta">("cardapio");
  const [cat, setCat] = useState<string | null>(null);
  const [picking, setPicking] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [state, setState] = useState<GuestState | null>(null);
  const [calling, setCalling] = useState<"garcom" | "conta" | null>(null);

  const refresh = useCallback(async () => {
    const s = await tableState(token).catch(() => null);
    if (s) setState(s);
  }, [token]);
  const tick = useEffectEvent(() => void refresh());
  useEffect(() => {
    let alive = true;
    tableState(token)
      .then((s) => alive && s && setState(s))
      .catch(() => {});
    const poll = setInterval(tick, 15_000);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [token]);

  const products = menu.products.filter((p) => sellable(p) && startingPrice(p, menu.prices) != null);
  const sections = menu.categories.map((c) => ({ ...c, products: products.filter((p) => p.category_id === c.id) })).filter((c) => c.products.length > 0);
  const add = (i: Omit<CartItem, "key">) => setCart((s) => [...s, { ...i, key: crypto.randomUUID() }]);
  const pick = (p: Product) => {
    if (!canOrder) return;
    if (p.is_pizza || menu.extras.some((e) => e.available && !e.pizza_only)) return setPicking(p);
    add({ product_id: p.id, size_id: null, extra_ids: [], qty: 1, note: null, name: p.name, detail: "", image_url: p.image_url, preview_unit_cents: p.price_cents });
    toast.success(`${p.name} no seu pedido`);
  };
  const setQty = (key: string, qty: number) => setCart((s) => (qty <= 0 ? s.filter((i) => i.key !== key) : s.map((i) => (i.key === key ? { ...i, qty: Math.min(20, qty) } : i))));
  const count = cart.reduce((s, i) => s + i.qty, 0);
  const preview = cart.reduce((s, i) => s + i.preview_unit_cents * i.qty, 0);

  const send = async () => {
    if (!cart.length || sending) return;
    setSending(true);
    try {
      const r = await placeGuestOrder({ token, idempotency_key: idempotencyKey(`mesa-qr:${token}`), items: toLines(cart), name, notes });
      if (!r.ok) return void toast.error(r.error);
      idempotencyKey(`mesa-qr:${token}`, true);
      toast.success(r.confirmed ? "Pedido enviado para a cozinha!" : "Pedido enviado! A equipe vai confirmar em instantes.");
      setCart([]);
      setNotes("");
      setCartOpen(false);
      setView("conta");
      await refresh();
    } catch {
      toast.error("Sem conexão. Tente de novo: o mesmo pedido não será duplicado.");
    } finally {
      setSending(false);
    }
  };

  const call = async (kind: "garcom" | "conta") => {
    setCalling(kind);
    const r = await callStaff(token, kind).catch(() => ({ ok: false, error: "Sem conexão." }));
    setCalling(null);
    if (!r.ok) return void toast.error(r.error ?? "Não foi possível chamar.");
    toast.success(kind === "garcom" ? "Garçom chamado! Já vem atender." : "Conta pedida! O garçom já traz.");
    await refresh();
  };

  const called = (k: "garcom" | "conta") => state?.calls.includes(k) ?? false;
  const tot = state?.totals;

  if (!active) {
    return (
      <Shell store={menu.pizzeria.name} table={tableName}>
        <p className="card p-6 text-center text-sm">Esta mesa não está disponível agora. Fale com o garçom.</p>
      </Shell>
    );
  }

  return (
    <Shell store={menu.pizzeria.name} table={tableName}>
      <div className="grid grid-cols-2 gap-2">
        <button className={called("garcom") ? "btn-ghost !py-3" : "btn-dark !py-3"} disabled={calling != null || called("garcom")} onClick={() => call("garcom")}>
          {calling === "garcom" ? <Spinner className="h-4 w-4" /> : called("garcom") ? <Check className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {called("garcom") ? "Garçom chamado" : "Chamar garçom"}
        </button>
        <button className={called("conta") ? "btn-ghost !py-3" : "btn-dark !py-3"} disabled={calling != null || called("conta")} onClick={() => call("conta")}>
          {calling === "conta" ? <Spinner className="h-4 w-4" /> : called("conta") ? <Check className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
          {called("conta") ? "Conta pedida" : "Pedir a conta"}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 rounded-full bg-sand p-1 text-sm font-bold">
        <button className={`rounded-full py-2 ${view === "cardapio" ? "bg-surface shadow" : "text-muted"}`} onClick={() => setView("cardapio")}>
          Cardápio
        </button>
        <button className={`rounded-full py-2 ${view === "conta" ? "bg-surface shadow" : "text-muted"}`} onClick={() => setView("conta")}>
          Minha conta{tot && tot.total > 0 ? ` · ${brl(tot.total)}` : ""}
        </button>
      </div>

      {view === "cardapio" ? (
        <>
          {!canOrder && <p className="mt-4 rounded-2xl bg-dende-soft p-3 text-sm font-semibold text-warning">Veja o cardápio e faça o pedido com o garçom.</p>}
          <nav aria-label="Categorias" className="sticky top-[60px] z-20 -mx-4 mt-3 flex gap-2 overflow-x-auto bg-background/90 px-4 py-2 backdrop-blur">
            {sections.map((c) => (
              <a key={c.id} href={`#cat-${c.id}`} data-active={cat === c.id} onClick={() => setCat(c.id)} className="chip shrink-0">
                {c.name}
              </a>
            ))}
          </nav>
          {sections.map((c) => (
            <section key={c.id} id={`cat-${c.id}`} className="mt-5 scroll-mt-28">
              <h2 className="text-xl font-extrabold">{c.name}</h2>
              <div className="mt-2 grid gap-2">
                {c.products.map((p) => (
                  <button key={p.id} onClick={() => pick(p)} disabled={!canOrder} className="card flex items-center gap-3 p-3 text-left disabled:cursor-default">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{p.name}</p>
                      {p.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{p.description}</p>}
                      <p className="mt-1 text-sm font-bold text-tomato">
                        {p.is_pizza ? "a partir de " : ""}
                        {brl(startingPrice(p, menu.prices)!)}
                      </p>
                    </div>
                    <ProductImage src={p.image_url} alt={p.name} size={72} className="w-[72px] shrink-0" />
                    {canOrder && (
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tomato text-paper">
                        <Plus className="h-4 w-4" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </>
      ) : (
        <section className="mt-4 space-y-3">
          {!state ? (
            <div className="grid place-items-center py-10">
              <Spinner />
            </div>
          ) : state.rounds.length === 0 ? (
            <p className="card p-6 text-center text-sm text-muted">Nenhum pedido nesta mesa ainda.</p>
          ) : (
            state.rounds.map((r) => (
              <div key={r.id} className="card p-3 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-bold">Pedido #{r.number}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${GUEST_STATUS[r.status].cls}`}>{GUEST_STATUS[r.status].label}</span>
                </div>
                <ul className={`space-y-0.5 text-xs ${r.status === "cancelado" ? "text-muted line-through" : ""}`}>
                  {r.items.map((i) => (
                    <li key={i.id} className="flex justify-between gap-2">
                      <span>
                        {i.qty}× {i.name}
                        {i.size_name ? ` (${i.size_name})` : ""}
                        {i.extras.length ? ` + ${i.extras.map((e) => e.name).join(", ")}` : ""}
                      </span>
                      <span>{brl(i.subtotal_cents)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {tot && tot.subtotal > 0 && (
            <div className="card space-y-1 p-4 text-sm">
              <p className="flex justify-between">
                <span>Consumo</span>
                <span>{brl(tot.subtotal)}</span>
              </p>
              {tot.service > 0 && (
                <p className="flex justify-between">
                  <span>Taxa de serviço ({tot.service_pct}%, opcional)</span>
                  <span>{brl(tot.service)}</span>
                </p>
              )}
              <p className="flex justify-between text-base font-bold">
                <span>Total</span>
                <span>{brl(tot.total)}</span>
              </p>
              {tot.paid > 0 && (
                <>
                  <p className="flex justify-between text-muted">
                    <span>Já pago</span>
                    <span>− {brl(tot.paid)}</span>
                  </p>
                  <p className="flex justify-between font-bold">
                    <span>Falta pagar</span>
                    <span>{brl(Math.max(0, tot.remaining))}</span>
                  </p>
                </>
              )}
              <p className="pt-1 text-xs text-muted">O pagamento é feito com a equipe. Toque em “Pedir a conta” quando quiser fechar.</p>
            </div>
          )}
        </section>
      )}

      {canOrder && count > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-3">
          <button className="btn mx-auto flex w-full max-w-xl justify-between !py-4 shadow-2xl" onClick={() => setCartOpen(true)}>
            <span className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" /> Ver meu pedido ({count})
            </span>
            <span>{brl(preview)}</span>
          </button>
        </div>
      )}

      {picking && (
        <Drawer title={picking.name} onClose={() => setPicking(null)}>
          <ProductBuilder
            menu={menu}
            product={picking}
            onAdd={(i) => {
              add(i);
              setPicking(null);
              toast.success(`${i.name} no seu pedido`);
            }}
          />
        </Drawer>
      )}

      {cartOpen && (
        <Drawer title={`Pedido da Mesa ${tableName}`} onClose={() => setCartOpen(false)}>
          <div className="space-y-4 text-sm">
            {cart.length === 0 ? (
              <p className="text-muted">Seu pedido está vazio.</p>
            ) : (
              <ul className="space-y-2">
                {cart.map((i) => (
                  <li key={i.key} className="flex items-center gap-2 rounded-xl bg-sand/60 p-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{i.name}</p>
                      {i.detail && <p className="text-[11px] text-muted">{i.detail}</p>}
                      <p className="text-xs">{brl(i.preview_unit_cents * i.qty)}</p>
                    </div>
                    <button aria-label="Diminuir" onClick={() => setQty(i.key, i.qty - 1)} className="grid h-8 w-8 place-items-center rounded-full bg-surface">
                      {i.qty === 1 ? <Trash2 className="h-4 w-4 text-danger" /> : <Minus className="h-4 w-4" />}
                    </button>
                    <span className="w-5 text-center font-bold">{i.qty}</span>
                    <button aria-label="Aumentar" onClick={() => setQty(i.key, i.qty + 1)} className="grid h-8 w-8 place-items-center rounded-full bg-surface">
                      <Plus className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-muted">Seu nome (opcional, ajuda a dividir a conta)</span>
              <input className="field" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Ana" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-muted">Observação (opcional)</span>
              <input className="field" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: trazer as bebidas primeiro" />
            </label>
            <button className="btn w-full !py-4" disabled={!cart.length || sending} onClick={send}>
              {sending ? <Spinner className="h-4 w-4" /> : <ChefHat className="h-4 w-4" />} Enviar pedido · {brl(preview)}
            </button>
            <p className="text-center text-xs text-muted">O valor final é conferido pela loja. Você paga no fim, com a equipe.</p>
          </div>
        </Drawer>
      )}
    </Shell>
  );
}

function Shell({ store, table, children }: { store: string; table: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh pb-28">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-3">
          <p className="truncate font-brand text-lg font-extrabold">{store}</p>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-charcoal px-3 py-1 text-sm font-bold text-cream">
            <UtensilsCrossed className="h-4 w-4" /> Mesa {table}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 pt-4">{children}</main>
    </div>
  );
}
