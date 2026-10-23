"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banknote, Bike, CreditCard, Info, MapPin, QrCode, Store } from "lucide-react";
import { toast } from "sonner";
import { QuoteSummary } from "@/components/store/quote-summary";
import { Field, Spinner } from "@/components/ui";
import { toLines, useCart } from "@/lib/cart";
import { parseMoney } from "@/lib/money";
import { normalizeBrPhone, PHONE_ERROR } from "@/lib/phone";
import { idempotencyKey, useQuote } from "@/lib/use-quote";
import type { DeliveryMode, Fulfillment, PaymentMethod } from "@/lib/types";
import { placeSiteOrder, quoteSiteOrder } from "../actions";

type Store = { name: string; allow_delivery: boolean; allow_pickup: boolean; delivery_mode: DeliveryMode };
const PAY: [PaymentMethod, string, typeof QrCode][] = [
  ["pix", "Pix", QrCode],
  ["cartao", "Cartão", CreditCard],
  ["dinheiro", "Dinheiro", Banknote],
];

export function Checkout({ slug, store, neighborhoods }: { slug: string; store: Store; neighborhoods: string[] }) {
  const router = useRouter();
  const { items, clear } = useCart(slug);
  const [mode, setMode] = useState<Fulfillment>(store.allow_delivery ? "entrega" : "retirada");
  const [pay, setPay] = useState<PaymentMethod>("pix");
  const [f, setF] = useState({ name: "", phone: "", street: "", number: "", complement: "", neighborhood: "", reference: "", change: "", notes: "", coupon: "", website: "" });
  const [coupon, setCoupon] = useState("");
  const [sending, setSending] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const lines = toLines(items);
  const neighborhood = mode === "entrega" ? f.neighborhood : "";
  const { quote, error, loading, refresh } = useQuote(items.length > 0, [lines, mode, neighborhood, coupon], () =>
    quoteSiteOrder(slug, { items: lines, fulfillment: mode, neighborhood, coupon }),
  );

  if (items.length === 0) {
    return (
      <div className="card mx-auto mt-6 max-w-lg p-10 text-center">
        <p className="font-bold">Sua sacola está vazia.</p>
        <Link href={`/${slug}`} className="btn mt-4">
          Ver cardápio
        </Link>
      </div>
    );
  }

  const phoneOk = normalizeBrPhone(f.phone) !== null;
  const addressOk = mode === "retirada" || (f.street.trim() && f.number.trim() && f.neighborhood.trim());
  const changeCents = pay === "dinheiro" && f.change.trim() ? parseMoney(f.change) : null;
  const ready =
    !!quote && !quote.blocked && !quote.min_order_error && quote.delivery.ok && !quote.coupon_error && f.name.trim().length >= 2 && phoneOk && !!addressOk;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || sending) return;
    setSending(true);
    try {
      const r = await placeSiteOrder({
        slug,
        items: lines,
        fulfillment: mode,
        neighborhood,
        coupon,
        idempotency_key: idempotencyKey(`site:${slug}`),
        customer_name: f.name,
        customer_phone: f.phone,
        address: mode === "entrega" ? { street: f.street, number: f.number, complement: f.complement, neighborhood: f.neighborhood, reference: f.reference } : null,
        payment_method: pay,
        change_for_cents: changeCents,
        notes: f.notes,
        website: f.website,
      });
      if (!r.ok) {
        toast.error(r.error);
        await refresh();
        return;
      }
      idempotencyKey(`site:${slug}`, true);
      clear();
      try {
        localStorage.setItem(`pav-ultimo-pedido:${slug}`, r.token);
      } catch {
        // sem armazenamento: o link do pedido continua valendo
      }
      router.push(`/pedido/${r.token}`);
    } catch {
      toast.error("Sem conexão. Tente de novo: o mesmo pedido não será duplicado.");
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <h1 className="text-3xl font-extrabold">Finalizar pedido</h1>
      <div className="mt-4 grid gap-5 md:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <section className="card space-y-3 p-5">
            <h2 className="text-base font-bold">Seus dados</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome">
                <input className="field" value={f.name} onChange={set("name")} maxLength={80} autoComplete="name" required />
              </Field>
              <Field label="Telefone / WhatsApp com DDD">
                <input className="field" value={f.phone} onChange={set("phone")} maxLength={25} inputMode="tel" autoComplete="tel" required />
              </Field>
            </div>
            {f.phone.trim().length >= 8 && !phoneOk && <p className="text-xs font-semibold text-danger">{PHONE_ERROR}</p>}
            {/* Campo invisível contra robôs */}
            <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={f.website} onChange={set("website")} name="website" />
          </section>

          <section className="card p-5">
            <h2 className="text-base font-bold">Como você quer receber?</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" disabled={!store.allow_delivery} data-active={mode === "entrega"} onClick={() => setMode("entrega")} className="chip !justify-center !rounded-2xl !py-3 disabled:opacity-40">
                <Bike className="h-4 w-4" /> Entrega
              </button>
              <button type="button" disabled={!store.allow_pickup} data-active={mode === "retirada"} onClick={() => setMode("retirada")} className="chip !justify-center !rounded-2xl !py-3 disabled:opacity-40">
                <Store className="h-4 w-4" /> Retirada
              </button>
            </div>
          </section>

          {mode === "entrega" && (
            <section className="card space-y-3 p-5">
              <h2 className="flex items-center gap-2 text-base font-bold">
                <MapPin className="h-4 w-4 text-tomato" /> Endereço de entrega
              </h2>
              <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                <Field label="Rua / avenida">
                  <input className="field" value={f.street} onChange={set("street")} maxLength={120} autoComplete="address-line1" />
                </Field>
                <Field label="Número">
                  <input className="field" value={f.number} onChange={set("number")} maxLength={20} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Bairro">
                  {neighborhoods.length > 0 ? (
                    <select className="field" value={f.neighborhood} onChange={set("neighborhood")}>
                      <option value="">Escolha o bairro</option>
                      {neighborhoods.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="field" value={f.neighborhood} onChange={set("neighborhood")} maxLength={80} />
                  )}
                </Field>
                <Field label="Complemento (opcional)">
                  <input className="field" value={f.complement} onChange={set("complement")} maxLength={80} />
                </Field>
              </div>
              <Field label="Ponto de referência (opcional)">
                <input className="field" value={f.reference} onChange={set("reference")} maxLength={120} />
              </Field>
              {store.delivery_mode === "bairro" && neighborhoods.length > 0 && <p className="text-xs text-muted">Não achou seu bairro? Talvez ainda não entreguemos aí — escolha retirada.</p>}
            </section>
          )}

          <section className="card space-y-3 p-5">
            <h2 className="text-base font-bold">Pagamento na {mode}</h2>
            <div className="grid grid-cols-3 gap-2">
              {PAY.map(([id, label, Icon]) => (
                <button key={id} type="button" data-active={pay === id} onClick={() => setPay(id)} className="chip !justify-center !rounded-2xl !py-3">
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
            {pay === "dinheiro" && (
              <Field label="Troco para quanto? (opcional)">
                <input className="field" value={f.change} onChange={set("change")} inputMode="decimal" placeholder="Ex.: 100,00" />
              </Field>
            )}
            <p className="flex items-start gap-2 rounded-xl bg-info-soft p-3 text-xs text-info">
              <Info className="mt-0.5 h-4 w-4 shrink-0" /> O pagamento é feito na {mode}. Sua escolha avisa a loja como você vai pagar.
            </p>
          </section>

          <section className="card space-y-3 p-5">
            <h2 className="text-base font-bold">Cupom e observações</h2>
            <div className="flex gap-2">
              <input className="field" placeholder="Código do cupom" value={f.coupon} onChange={set("coupon")} maxLength={30} />
              <button type="button" className="btn-ghost shrink-0" onClick={() => setCoupon(f.coupon.trim())}>
                Aplicar
              </button>
            </div>
            <Field label="Observações para a loja (opcional)">
              <textarea className="field" rows={2} value={f.notes} onChange={set("notes")} maxLength={300} placeholder="Ex.: interfone com defeito, ligar ao chegar" />
            </Field>
          </section>
        </div>

        <aside className="card h-fit space-y-3 p-5 md:sticky md:top-24">
          <h2 className="flex items-center gap-2 text-base font-bold">Resumo {loading && <Spinner className="h-4 w-4 text-muted" />}</h2>
          {error && <p className="rounded-xl bg-tomato-soft p-3 text-sm text-tomato-deep">{error}</p>}
          {quote && <QuoteSummary quote={quote} fulfillment={mode} />}
          <button type="submit" disabled={!ready || sending || loading} className="btn w-full !py-3.5">
            {sending ? (
              <>
                <Spinner className="h-4 w-4" /> Enviando…
              </>
            ) : (
              "Fazer pedido"
            )}
          </button>
          <p className="text-[11px] text-muted">Os valores são calculados pela {store.name} com o cardápio atual.</p>
        </aside>
      </div>
    </form>
  );
}
