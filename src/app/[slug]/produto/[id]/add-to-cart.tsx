"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ProductBuilder } from "@/components/store/product-builder";
import { useCart } from "@/lib/cart";
import type { Menu, Product } from "@/lib/types";

export function AddToCart({ slug, menu, product }: { slug: string; menu: Menu; product: Product }) {
  const { add } = useCart(slug);
  const router = useRouter();
  return (
    <ProductBuilder
      menu={menu}
      product={product}
      submitLabel="Adicionar à sacola"
      onAdd={(item) => {
        add(item);
        toast.success("Adicionado à sacola");
        router.push(`/${slug}/sacola`);
      }}
    />
  );
}
