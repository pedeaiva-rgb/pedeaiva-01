"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, ShoppingBag } from "lucide-react";
import { ProductBuilder } from "@/components/store/product-builder";
import { useCart, type CartItem } from "@/lib/cart";
import { brl } from "@/lib/money";
import type { Menu, Product } from "@/lib/types";

/** Montagem + confirmação: depois de adicionar, o cliente escolhe se continua pedindo ou vai para a sacola. */
export function AddToCart({ slug, menu, product, sizeId }: { slug: string; menu: Menu; product?: Product; sizeId?: string }) {
  const { add, count, previewSubtotal } = useCart(slug);
  const router = useRouter();
  const [added, setAdded] = useState<Omit<CartItem, "key"> | null>(null);
  // Remonta a montagem depois de adicionar, para começar do zero se o cliente quiser outro igual.
  const [round, setRound] = useState(0);

  return (
    <>
      <ProductBuilder
        key={round}
        menu={menu}
        product={product}
        sizeId={sizeId}
        submitLabel="Adicionar à sacola"
        onAdd={(item) => {
          add(item);
          setAdded(item);
          setRound((r) => r + 1);
        }}
      />
      {added && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Item adicionado">
          <button aria-label="Fechar" className="absolute inset-0 bg-charcoal/40" onClick={() => setAdded(null)} />
          <div className="relative w-full max-w-md rounded-t-[1.75rem] bg-surface p-6 shadow-2xl sm:rounded-[1.75rem]">
            <p className="flex items-center gap-2 text-lg font-extrabold">
              <CheckCircle2 className="h-6 w-6 text-success" /> Adicionado à sacola!
            </p>
            <p className="mt-2 text-sm">
              {added.qty}× <b>{added.name}</b>
              {added.detail && <span className="block text-xs text-muted">{added.detail}</span>}
            </p>
            <p className="mt-3 rounded-2xl bg-sand/70 px-4 py-2.5 text-sm">
              Sacola: <b>{count} {count === 1 ? "item" : "itens"}</b> · {brl(previewSubtotal)}
            </p>
            <div className="mt-5 grid gap-2">
              <button className="btn w-full !py-3.5" onClick={() => router.push(`/${slug}`)}>
                Continuar pedindo
              </button>
              <Link href={`/${slug}/sacola`} className="btn-ghost w-full !py-3.5">
                <ShoppingBag className="h-4 w-4" /> Ver sacola e finalizar
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
