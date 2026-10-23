"use client";

import Link from "next/link";
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { ProductImage } from "@/components/store/product-image";
import { useCart } from "@/lib/cart";
import { brl } from "@/lib/money";

export function CartView({ slug }: { slug: string }) {
  const { items, setQty, previewSubtotal } = useCart(slug);
  if (items.length === 0) {
    return (
      <div className="card mx-auto mt-6 flex max-w-lg flex-col items-center gap-3 p-10 text-center">
        <ShoppingBag className="h-10 w-10 text-tomato" />
        <h1 className="text-2xl font-extrabold">Sua sacola está vazia</h1>
        <p className="text-sm text-muted">Que tal começar por uma pizza quentinha?</p>
        <Link href={`/${slug}`} className="btn mt-2">
          Ver cardápio
        </Link>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-3xl font-extrabold">Sua sacola</h1>
      <div className="mt-4 grid gap-5 md:grid-cols-[1fr_340px]">
        <ul className="space-y-3">
          {items.map((i) => (
            <li key={i.key} className="card flex items-center gap-3 p-3">
              <ProductImage src={i.image_url} alt="" size={72} className="w-18 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{i.name}</p>
                {i.detail && <p className="truncate text-xs text-muted">{i.detail}</p>}
                {i.note && <p className="truncate text-xs text-muted italic">“{i.note}”</p>}
                <p className="mt-1 text-sm font-extrabold">{brl(i.preview_unit_cents * i.qty)}</p>
              </div>
              <div className="flex items-center gap-2 rounded-full border px-2 py-1">
                <button aria-label={i.qty === 1 ? "Remover" : "Diminuir"} onClick={() => setQty(i.key, i.qty - 1)} className="grid h-7 w-7 place-items-center">
                  {i.qty === 1 ? <Trash2 className="h-4 w-4 text-danger" /> : <Minus className="h-4 w-4" />}
                </button>
                <span className="w-5 text-center text-sm font-bold">{i.qty}</span>
                <button aria-label="Aumentar" onClick={() => setQty(i.key, i.qty + 1)} className="grid h-7 w-7 place-items-center">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <aside className="card h-fit space-y-3 p-5">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Subtotal estimado</span>
            <b>{brl(previewSubtotal)}</b>
          </div>
          <p className="text-xs text-muted">Entrega, cupom e valor final são calculados pela loja ao finalizar.</p>
          <Link href={`/${slug}/finalizar`} className="btn w-full">
            Finalizar pedido <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href={`/${slug}`} className="btn-ghost w-full">
            Adicionar mais itens
          </Link>
        </aside>
      </div>
    </>
  );
}
