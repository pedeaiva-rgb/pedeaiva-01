"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { CartLine } from "./pricing";

/** A sacola guarda só os IDs e uma prévia do preço; o servidor recalcula tudo ao finalizar. */
export type CartItem = {
  key: string;
  product_id: string;
  size_id: string | null;
  flavor_ids?: string[];
  extra_ids: string[];
  qty: number;
  note: string | null;
  name: string;
  detail: string;
  image_url: string | null;
  preview_unit_cents: number;
};

const EMPTY: CartItem[] = [];
const cache = new Map<string, CartItem[]>();
const listeners = new Set<() => void>();
const storageKey = (slug: string) => `pav-sacola:${slug}`;

function read(slug: string): CartItem[] {
  if (typeof window === "undefined") return EMPTY;
  const hit = cache.get(slug);
  if (hit) return hit;
  let items: CartItem[] = EMPTY;
  try {
    const raw = localStorage.getItem(storageKey(slug));
    if (raw) items = JSON.parse(raw);
  } catch {
    items = EMPTY;
  }
  cache.set(slug, items);
  return items;
}

function write(slug: string, items: CartItem[]) {
  cache.set(slug, items);
  try {
    localStorage.setItem(storageKey(slug), JSON.stringify(items));
  } catch {
    // Navegação privada sem armazenamento: a sacola vale só nesta aba.
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("pav-sacola:")) {
      cache.delete(e.key.slice("pav-sacola:".length));
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCart(slug: string) {
  const items = useSyncExternalStore(
    subscribe,
    () => read(slug),
    () => EMPTY,
  );
  const add = useCallback((i: Omit<CartItem, "key">) => write(slug, [...read(slug), { ...i, key: crypto.randomUUID() }]), [slug]);
  const setQty = useCallback(
    (key: string, qty: number) =>
      write(
        slug,
        qty <= 0 ? read(slug).filter((i) => i.key !== key) : read(slug).map((i) => (i.key === key ? { ...i, qty: Math.min(qty, 50) } : i)),
      ),
    [slug],
  );
  const clear = useCallback(() => write(slug, EMPTY), [slug]);
  const count = items.reduce((a, i) => a + i.qty, 0);
  const previewSubtotal = items.reduce((a, i) => a + i.qty * i.preview_unit_cents, 0);
  return { items, count, previewSubtotal, add, setQty, clear };
}

export const toLines = (items: CartItem[]): CartLine[] =>
  items.map((i) => ({ product_id: i.product_id, size_id: i.size_id, flavor_ids: i.flavor_ids, extra_ids: i.extra_ids, qty: i.qty, note: i.note }));
