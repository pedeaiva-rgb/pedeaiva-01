"use client";

import { Check, Minus, Plus, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { CartItem } from "@/lib/cart";
import { brl } from "@/lib/money";
import { priceLine, PricingError, sellable } from "@/lib/pricing";
import type { Menu, Product } from "@/lib/types";

const HALF_LABEL = { mais_caro: "cobra o sabor mais caro", media: "cobra a média dos sabores" } as const;

/**
 * Montagem do item (loja online e PDV). O preço mostrado é prévia; o servidor recalcula.
 * - Pelo sabor (`product`): começa com aquele sabor; meio a meio é opcional, num botão.
 * - Pelo tamanho (`sizeId`, sem `product`): o tamanho vem escolhido e o cliente escolhe os sabores.
 */
export function ProductBuilder({
  menu,
  product,
  sizeId: initialSize,
  onAdd,
  submitLabel = "Adicionar",
}: {
  menu: Menu;
  product?: Product;
  sizeId?: string;
  onAdd: (item: Omit<CartItem, "key">) => void;
  submitLabel?: string;
}) {
  const bySize = !product;
  const isPizza = bySize || product.is_pizza;
  const pizzas = useMemo(() => menu.products.filter((p) => p.is_pizza && sellable(p)), [menu.products]);
  const priceOf = (productId: string, sizeId: string) => menu.prices.find((x) => x.product_id === productId && x.size_id === sizeId)?.price_cents;

  // Tamanhos possíveis: os do sabor escolhido, ou os que têm alguma pizza com preço.
  const sizes = useMemo(
    () =>
      menu.sizes.filter((s) =>
        s.active && (product ? menu.prices.some((x) => x.product_id === product.id && x.size_id === s.id) : pizzas.some((p) => menu.prices.some((x) => x.product_id === p.id && x.size_id === s.id))),
      ),
    [menu, product, pizzas],
  );
  const [sizeId, setSizeId] = useState<string | null>(initialSize ?? sizes[Math.min(2, sizes.length - 1)]?.id ?? null);
  const [flavors, setFlavors] = useState<string[]>(product ? [product.id] : []);
  const [picking, setPicking] = useState(bySize);
  const [extras, setExtras] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  const size = sizes.find((s) => s.id === sizeId);
  const choices = size ? pizzas.filter((x) => priceOf(x.id, size.id) != null) : [];
  const allowedExtras = menu.extras.filter((e) => e.available && (isPizza || !e.pizza_only));
  const max = size?.max_flavors ?? 1;
  const base = flavors[0] ?? product?.id;

  let preview: ReturnType<typeof priceLine> | null = null;
  let error: string | null = null;
  // Pelo tamanho, sem sabor escolhido ainda não há preço (base fica vazio).
  if (base) {
    try {
      preview = priceLine({ product_id: base, size_id: isPizza ? sizeId : null, flavor_ids: isPizza ? flavors : undefined, extra_ids: extras, qty }, menu, menu.pizzeria.half_pricing);
    } catch (e) {
      error = e instanceof PricingError ? e.message : "Indisponível";
    }
  }

  const chooseSize = (id: string) => {
    const s = sizes.find((x) => x.id === id)!;
    setSizeId(id);
    // Mantém só os sabores que existem no novo tamanho, até o limite dele.
    setFlavors((f) => f.filter((fid) => priceOf(fid, id) != null).slice(0, s.max_flavors));
  };
  const toggleFlavor = (fid: string) => {
    if (flavors.includes(fid)) {
      if (product && fid === product.id && flavors.length === 1) return;
      setFlavors(flavors.filter((f) => f !== fid));
      return;
    }
    if (flavors.length >= max) {
      toast.error(`A ${size?.name ?? "pizza"} permite até ${max} sabor(es).`);
      return;
    }
    setFlavors([...flavors, fid]);
  };

  const add = () => {
    if (!preview || !base) return;
    const img = menu.products.find((p) => p.id === base)?.image_url ?? null;
    onAdd({
      product_id: base,
      size_id: isPizza ? sizeId : null,
      flavor_ids: isPizza ? flavors : undefined,
      extra_ids: extras,
      qty,
      note: note.trim() || null,
      name: preview.name,
      detail: [preview.size_name, ...preview.extras.map((e) => `+ ${e.name}`)].filter(Boolean).join(" · "),
      image_url: img,
      preview_unit_cents: preview.unit_price_cents,
    });
  };

  const flavorName = (id: string) => menu.products.find((p) => p.id === id)?.name ?? "";
  const others = choices.filter((x) => !flavors.includes(x.id));

  return (
    <div>
      {isPizza && (
        <>
          <Section title="1. Tamanho">
            {sizes.length === 0 ? (
              <p className="text-sm text-muted">Nenhum tamanho disponível.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {sizes.map((s) => {
                  const p = product ? priceOf(product.id, s.id) : undefined;
                  return (
                    <button key={s.id} type="button" data-active={sizeId === s.id} onClick={() => chooseSize(s.id)} className="chip !flex-col !items-start !rounded-2xl !py-2.5">
                      <span>{s.name}</span>
                      <span className="text-[11px] font-medium text-muted">
                        {s.description ? `${s.description} · ` : ""}
                        {s.max_flavors > 1 ? `até ${s.max_flavors} sabores` : "1 sabor"}
                      </span>
                      {p != null && <span className="text-xs font-extrabold text-tomato">{brl(p)}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </Section>

          {size && bySize && (
            <Section title={`2. Sabores · escolha até ${max} (${flavors.length} de ${max})`}>
              {max > 1 && <p className="-mt-1 mb-2 text-xs text-muted">Meio a meio {HALF_LABEL[menu.pizzeria.half_pricing]}.</p>}
              <FlavorList items={choices} selected={flavors} sizeId={size.id} priceOf={priceOf} onToggle={toggleFlavor} />
            </Section>
          )}

          {size && !bySize && (
            <Section title="2. Sabor">
              <div className="flex flex-wrap gap-2">
                {flavors.map((fid) => (
                  <span key={fid} className="chip" data-active="true">
                    {flavors.length > 1 && <span className="text-[11px] font-bold">1/{flavors.length}</span>} {flavorName(fid)}
                    {fid !== product!.id && (
                      <button type="button" aria-label={`Tirar ${flavorName(fid)}`} onClick={() => toggleFlavor(fid)}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {max > 1 && flavors.length < max && others.length > 0 && !picking && (
                <button type="button" onClick={() => setPicking(true)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-tomato">
                  <Plus className="h-4 w-4" /> Adicionar outro sabor (meio a meio, até {max})
                </button>
              )}
              {picking && max > 1 && (
                <div className="mt-3 rounded-2xl bg-sand/60 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-bold text-muted">
                      Escolha mais {max - flavors.length} sabor(es) · {HALF_LABEL[menu.pizzeria.half_pricing]}
                    </p>
                    <button type="button" className="text-xs font-bold text-muted" onClick={() => setPicking(false)}>
                      Fechar
                    </button>
                  </div>
                  <FlavorList items={others} selected={flavors} sizeId={size.id} priceOf={priceOf} onToggle={toggleFlavor} />
                </div>
              )}
            </Section>
          )}
        </>
      )}
      {allowedExtras.length > 0 && (
        <Section title={isPizza ? "3. Adicionais e bordas (opcional)" : "Adicionais (opcional)"}>
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
          {bySize && flavors.length === 0 ? "Escolha o sabor" : `${submitLabel}${preview ? ` · ${brl(preview.subtotal_cents)}` : ""}`}
        </button>
      </div>
    </div>
  );
}

function FlavorList({
  items,
  selected,
  sizeId,
  priceOf,
  onToggle,
}: {
  items: Product[];
  selected: string[];
  sizeId: string;
  priceOf: (productId: string, sizeId: string) => number | undefined;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) return <p className="text-sm text-muted">Nenhum sabor disponível neste tamanho.</p>;
  return (
    <ul className="divide-y rounded-2xl bg-surface px-3 shadow-[var(--shadow-soft)]">
      {items.map((x) => {
        const on = selected.includes(x.id);
        return (
          <li key={x.id}>
            <button type="button" onClick={() => onToggle(x.id)} className="flex w-full items-center gap-3 py-2.5 text-left">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${on ? "border-tomato bg-tomato text-paper" : "border-line"}`}>{on && <Check className="h-3.5 w-3.5" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{x.name}</span>
                {x.description && <span className="block truncate text-xs text-muted">{x.description}</span>}
              </span>
              <span className="text-sm font-semibold">{brl(priceOf(x.id, sizeId) ?? 0)}</span>
            </button>
          </li>
        );
      })}
    </ul>
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
