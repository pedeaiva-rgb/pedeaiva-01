"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "@/lib/cart";
import { brl } from "@/lib/money";

export function CartButton({ slug }: { slug: string }) {
  const { count } = useCart(slug);
  return (
    <Link href={`/${slug}/sacola`} aria-label={`Sacola com ${count} itens`} className="relative grid h-11 w-11 place-items-center rounded-2xl bg-surface shadow-[var(--shadow-soft)]">
      <ShoppingBag className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-tomato px-1 text-[11px] font-bold text-paper">{count}</span>
      )}
    </Link>
  );
}

/** Barra fixa no rodapé do celular enquanto houver itens na sacola. */
export function CartBar({ slug }: { slug: string }) {
  const { count, previewSubtotal } = useCart(slug);
  if (count === 0) return null;
  return (
    <div className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-xl">
      <Link href={`/${slug}/sacola`} className="btn w-full justify-between !py-3.5">
        <span className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5" /> Ver sacola · {count} {count === 1 ? "item" : "itens"}
        </span>
        <span>{brl(previewSubtotal)}</span>
      </Link>
    </div>
  );
}
