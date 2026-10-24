"use client";

import { useState } from "react";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ProductBuilder } from "@/components/store/product-builder";
import { QuoteSummary } from "@/components/store/quote-summary";
import { Drawer, Empty, Field, Spinner } from "@/components/ui";
import { MoneyInput } from "@/components/ui/money-input";
import { PhoneInput } from "@/components/ui/phone-input";
import { toLines, type CartItem } from "@/lib/cart";
import { brl, parseMoney } from "@/lib/money";
import { CHANNEL_LABEL, PAYMENT_LABEL } from "@/lib/order-labels";
import { normalizeBrPhone, PHONE_ERROR } from "@/lib/phone";
import { sellable, startingPrice } from "@/lib/pricing";
import { idempotencyKey, useQuote } from "@/lib/use-quote";
import type { Fulfillment, Menu, PaymentMethod, Product } from "@/lib/types";
import { placePdvOrder, quotePdvOrder } from "./actions";

type Channel = "balcao" | "telefone" | "whatsapp";
const EMPTY = { name: "", phone: "", street: "", number: "", complement: "", neighborhood: "", reference: "", change: "", notes: "", coupon: "" };

/** canReceive: o atendente lança o pedido, mas o recebimento fica com o caixa. */
export function PdvScreen({ menu, canReceive }: { menu: Menu; canReceive: boolean }) {
  const pz = menu.pizzeria.id;
  const [cat, setCat] = useState("todas");
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [channel, setChannel] = useState<Channel>("balcao");
  const [mode, setMode] = useState<Fulfillment>("retirada");
  const [pay, setPay] = useState<PaymentMethod>("dinheiro");
  const [receivedNow, setReceivedNow] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [sending, setSending] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const products = menu.products.filter(
    (p) => sellable(p) && startingPrice(p, menu.prices) != null && (cat === "todas" || p.category_id === cat) && p.name.toLowerCase().includes(q.toLowerCase()),
  );
  const lines = toLines(cart);
  const neighborhood = mode === "entrega" ? f.neighborhood : "";
  const { quote, error, loading } = useQuote(cart.length > 0, [lines, mode, neighborhood, f.coupon], () =>
    quotePdvOrder(pz, { items: lines, fulfillment: mode, neighborhood, coupon: f.coupon }),
  );

  const addItem = (i: Omit<CartItem, "key">) => setCart((s) => [...s, { ...i, key: crypto.randomUUID() }]);
  const quick = (p: Product) => {
    if (p.is_pizza || menu.extras.some((e) => e.available && !e.pizza_only)) return setPicking(p);
    addItem({ product_id: p.id, size_id: null, extra_ids: [], qty: 1, note: null, name: p.name, detail: "", image_url: p.image_url, preview_unit_cents: p.price_cents });
  };
  const setQty = (key: string, qty: number) => setCart((s) => (qty <= 0 ? s.filter((i) => i.key !== key) : s.map((i) => (i.key === key ? { ...i, qty: Math.min(50, qty) } : i))));

  const phoneOk = !f.phone.trim() || normalizeBrPhone(f.phone) !== null;
  const deliveryOk = mode === "retirada" || (f.name.trim().length >= 2 && normalizeBrPhone(f.phone) && f.street && f.number && f.neighborhood);
  const ready = !!quote && quote.delivery.ok && !quote.coupon_error && phoneOk && !!deliveryOk && !loading;

  const finish = async () => {
    if (!ready || sending) return;
    setSending(true);
    try {
      const r = await placePdvOrder({
        pizzeria_id: pz,
        channel,
        items: lines,
        fulfillment: mode,
        neighborhood,
        coupon: f.coupon,
        idempotency_key: idempotencyKey(`pdv:${pz}`),
        customer_name: f.name,
        customer_phone: f.phone,
        address: mode === "entrega" ? { street: f.street, number: f.number, complement: f.complement, neighborhood: f.neighborhood, reference: f.reference } : null,
        payment_method: pay,
        change_for_cents: pay === "dinheiro" && f.change ? parseMoney(f.change) : null,
        notes: f.notes,
        received_now: receivedNow,
      });
      if (!r.ok) return void toast.error(r.error);
      if (r.payment_error) toast.error(r.payment_error);
      toast.success(`Pedido #${r.number} registrado · ${brl(r.total_cents)}`);
      idempotencyKey(`pdv:${pz}`, true);
      setCart([]);
      setF(EMPTY);
      setReceivedNow(false);
    } catch {
      toast.error("Sem conexão. Tente de novo: o mesmo pedido não será duplicado.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
      <section className="min-w-0">
        <h1 className="mb-3 text-2xl font-extrabold">PDV / Balcão</h1>
        <label className="relative mb-3 block">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input autoFocus className="field !pl-9" placeholder="Buscar produto" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
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
          <Empty>Nenhum produto à venda. Cadastre em Cardápio.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
      </section>

      <aside className="card h-fit space-y-3 p-4 xl:sticky xl:top-4">
        <h2 className="text-base font-bold">Pedido atual</h2>
        {cart.length === 0 ? (
          <Empty>Toque em um produto para adicionar.</Empty>
        ) : (
          <ul className="max-h-[30vh] space-y-2 overflow-y-auto">
            {cart.map((i) => (
              <li key={i.key} className="flex items-center gap-2 rounded-2xl bg-sand/60 p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{i.name}</p>
                  {i.detail && <p className="truncate text-[11px] text-muted">{i.detail}</p>}
                  <p className="text-[11px] text-muted">{brl(i.preview_unit_cents * i.qty)}</p>
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
        <div className="grid grid-cols-3 gap-1.5">
          {(["balcao", "telefone", "whatsapp"] as const).map((c) => (
            <button key={c} data-active={channel === c} onClick={() => setChannel(c)} className="chip !justify-center !px-2 text-xs">
              {CHANNEL_LABEL[c]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button data-active={mode === "retirada"} onClick={() => setMode("retirada")} className="chip !justify-center">
            Retirada
          </button>
          <button data-active={mode === "entrega"} onClick={() => setMode("entrega")} className="chip !justify-center">
            Entrega
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input className="field !py-2" placeholder={mode === "entrega" ? "Nome" : "Nome (opcional)"} value={f.name} onChange={set("name")} maxLength={80} />
          <PhoneInput
            aria-label="Telefone do cliente"
            className="field !py-2"
            placeholder={mode === "entrega" ? "Telefone" : "Telefone (opcional)"}
            value={f.phone}
            onChange={(v) => setF({ ...f, phone: v })}
          />
        </div>
        {!phoneOk && f.phone.replace(/\D/g, "").length >= 10 && <p className="text-xs font-semibold text-danger">{PHONE_ERROR}</p>}
        {mode === "entrega" && (
          <div className="grid grid-cols-[1fr_80px] gap-2">
            <input className="field !py-2" placeholder="Rua" value={f.street} onChange={set("street")} maxLength={120} />
            <input className="field !py-2" placeholder="Nº" value={f.number} onChange={set("number")} maxLength={20} />
            <input className="field !py-2" placeholder="Bairro" value={f.neighborhood} onChange={set("neighborhood")} maxLength={80} />
            <input className="field !py-2" placeholder="Compl." value={f.complement} onChange={set("complement")} maxLength={80} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-1.5">
          {(["dinheiro", "pix", "cartao"] as const).map((m) => (
            <button key={m} data-active={pay === m} onClick={() => setPay(m)} className="chip !justify-center !px-2 text-xs">
              {PAYMENT_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {pay === "dinheiro" && <MoneyInput aria-label="Troco para" className="field !py-2" placeholder="Troco para R$" value={f.change} onChange={(v) => setF({ ...f, change: v })} />}
          <input className="field !py-2" placeholder="Cupom" value={f.coupon} onChange={set("coupon")} maxLength={30} />
        </div>
        <Field label="Observação">
          <input className="field !py-2" value={f.notes} onChange={set("notes")} maxLength={300} />
        </Field>
        <div className="rounded-2xl bg-sand/60 p-3">
          {loading && cart.length > 0 && <Spinner className="mb-2 h-4 w-4 text-muted" />}
          {error && <p className="text-xs font-semibold text-danger">{error}</p>}
          {quote ? <QuoteSummary quote={quote} fulfillment={mode} /> : <p className="text-sm text-muted">Total: —</p>}
        </div>
        {quote && canReceive && (
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={receivedNow} onChange={(e) => setReceivedNow(e.target.checked)} />
            Recebi {brl(quote.total_cents)} agora ({PAYMENT_LABEL[pay]}). Deixe desmarcado se o cliente paga na entrega ou retirada.
          </label>
        )}
        <button className="btn w-full !py-3.5" disabled={!ready || sending} onClick={finish}>
          {sending && <Spinner className="h-4 w-4" />} Registrar pedido {quote ? `· ${brl(quote.total_cents)}` : ""}
        </button>
      </aside>

      {picking && (
        <Drawer title={picking.name} onClose={() => setPicking(null)}>
          <ProductBuilder
            menu={menu}
            product={picking}
            onAdd={(i) => {
              addItem(i);
              setPicking(null);
            }}
          />
        </Drawer>
      )}
    </div>
  );
}
