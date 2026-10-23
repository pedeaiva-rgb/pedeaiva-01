import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { ProductImage } from "@/components/store/product-image";
import { getStoreMenu } from "@/lib/menu";
import { brl } from "@/lib/money";
import { sellable, startingPrice } from "@/lib/pricing";
import { AddToCart } from "./add-to-cart";

export async function generateMetadata({ params }: PageProps<"/[slug]/produto/[id]">): Promise<Metadata> {
  const { slug, id } = await params;
  const p = (await getStoreMenu(slug))?.products.find((x) => x.id === id);
  return { title: p?.name ?? "Produto" };
}

export default async function ProductPage({ params }: PageProps<"/[slug]/produto/[id]">) {
  const { slug, id } = await params;
  const menu = await getStoreMenu(slug);
  const product = menu?.products.find((x) => x.id === id);
  if (!menu || !product) notFound();
  const price = startingPrice(product, menu.prices);

  return (
    <div>
      <Link href={`/${slug}`} aria-label="Voltar ao cardápio" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface shadow-[var(--shadow-soft)]">
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <div className="mt-4 grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ProductImage src={product.image_url} alt={product.name} size={520} className="mx-auto w-full md:sticky md:top-24" />
        <div>
          <h1 className="text-3xl font-extrabold md:text-4xl">{product.name}</h1>
          {product.description && <p className="mt-2 text-muted">{product.description}</p>}
          {price != null && (
            <p className="mt-3 text-lg font-extrabold text-tomato">
              {product.is_pizza && <span className="text-sm font-semibold text-muted">a partir de </span>}
              {brl(price)}
            </p>
          )}
          {sellable(product) && price != null ? (
            <AddToCart slug={slug} menu={menu} product={product} />
          ) : (
            <p className="mt-6 rounded-2xl bg-sand p-4 text-sm font-semibold text-muted">Este produto está indisponível no momento.</p>
          )}
        </div>
      </div>
    </div>
  );
}
