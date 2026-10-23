"use client";

import { Check, Minus, Plus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { CartItem } from "@/lib/cart";
import { brl } from "@/lib/money";
import { priceLine, PricingError, sellable } from "@/lib/pricing";
import type { Menu, Product } from "@/lib/types";

const HALF_LABEL = { mais_caro: "cobra o sabor mais caro", media: "cobra a média dos sabores" } as const;

/** Montagem do item (loja online e PDV). O preço mostrado é prévia; o servidor recalcula. */
export function ProductBuilder({
  menu,
  product,
  onAdd,
  submitLabel = "Adicionar",
}: {
  menu: Menu;
  product: Product;
  onAdd: (item: Omit<CartItem, "key">) => void;
  submitLabel?: string;
}) {
  const sizes = useMemo(
    () => menu.sizes.filter((s) => s.active && menu.prices.some((x) => x.product_id === product.id && x.size_id === s.id)),
    [menu, product.id],
  );
  const [sizeId, setSizeId] = useState<string | null>(sizes[Math.min(2, sizes.length - 1)]?.id ?? null);
  const [flavors, setFlavors] = useState<string[]>([product.id]);
  const [extras, setExtras] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  const size = sizes.find((s) => s.id === sizeId);
  const flavorChoices = size
    ? menu.products.filter((x) => x.is_pizza && sellable(x) && menu.prices.some((pr) => pr.product_id === x.id && pr.size_id === size.id))
    : [];
  const allowedExtras = menu.extras.filter((e) => e.available && (product.is_pizza || !e.pizza_only));

  let preview: ReturnType<typeof priceLine> | null = null;
  let error: string | null = null;
  try {
    preview = priceLine(
      { product_id: product.id, size_id: sizeId, flavor_ids: product.is_pizza ? flavors : undefined, extra_ids: extras, qty },
      menu,
      menu.pizzeria.half_pricing,
    );
  } catch (e) {
    error = e instanceof PricingError ? e.message : "Indisponível";
  }

  const toggleFlavor = (fid: string) => {
    if (flavors.includes(fid)) {
      if (flavors.length > 1) setFlavors(flavors.filter((f) => f !== fid));
      return;
    }
    if (size && flavors.length >= size.max_flavors) {
      toast.error(`A ${size.name} permite até ${size.max_flavors} sabor(es).`);
      return;
    }
    setFlavors([...flavors, fid]);
  };

  const add = () => {
    if (!preview) return;
    onAdd({
      product_id: product.id,
      size_id: product.is_pizza ? sizeId : null,
      flavor_ids: product.is_pizza ? flavors : undefined,
      extra_ids: extras,
      qty,
      note: note.trim() || null,
      name: preview.name,
      detail: [preview.size_name, ...preview.extras.map((e) => `+ ${e.name}`)].filter(Boolean).join(" · "),
      image_url: product.image_url,
      preview_unit_cents: preview.unit_price_cents,
    });
  };

  return (
    <div>
      {product.is_pizza && (
        <>
          <Section title="Tamanho">
            {sizes.length === 0 ? (
              <p className="text-sm text-muted">Nenhum tamanho disponível para esta pizza.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {sizes.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    data-active={sizeId === s.id}
                    onClick={() => {
                      setSizeId(s.id);
                      setFlavors((f) => f.slice(0, s.max_flavors));
                    }}
                    className="chip !flex-col !items-start !rounded-2xl !py-2.5"
                  >
                    <span>{s.name}</span>
                    <span className="text-[11px] font-medium text-muted">{s.description || `até ${s.max_flavors} sabor(es)`}</span>
                  </button>
                ))}
              </div>
            )}
          </Section>
          {size && size.max_flavors > 1 && flavorChoices.length > 1 && (
            <Section title={`Sabores · até ${size.max_flavors} (${HALF_LABEL[menu.pizzeria.half_pricing]})`}>
              <div className="flex flex-wrap gap-2">
                {flavorChoices.map((x) => (
                  <button key={x.id} type="button" data-active={flavors.includes(x.id)} onClick={() => toggleFlavor(x.id)} className="chip">
                    {x.name}
                    {flavors.includes(x.id) && <Check className="h-4 w-4" />}
                  </button>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
      {allowedExtras.length > 0 && (
        <Section title="Adicionais e bordas">
          <div className="flex flex-wrap gap-2">
            {allowedExtras.map((e) => (
              <button
                key={e.id}
                type="button"
                data-active={extras.includes(e.id)}
                onClick={() => setExtras(extras.includes(e.id) ? extras.filter((x) => x !== e.id) : [...extras, e.id])}
                className="chip"
              >
                {e.name} <span className="text-muted">+{brl(e.price_cents)}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
      <Section title="Alguma observação?">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} rows={2} placeholder="Ex.: sem cebola, bem assada…" className="field" />
      </Section>
      {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}
      <div className="mt-6 flex items-center gap-3">
        <div className="flex items-center gap-3 rounded-full bg-sand px-3 py-2">
          <button type="button" aria-label="Diminuir" onClick={() => setQty(Math.max(1, qty - 1))}>
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-5 text-center font-bold">{qty}</span>
          <button type="button" aria-label="Aumentar" onClick={() => setQty(Math.min(50, qty + 1))}>
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <button type="button" disabled={!preview} onClick={add} className="btn flex-1 !py-3">
          {submitLabel} {preview ? `· ${brl(preview.subtotal_cents)}` : ""}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 font-sans text-sm font-bold text-muted">{title}</h3>
      {children}
    </section>
  );
}
