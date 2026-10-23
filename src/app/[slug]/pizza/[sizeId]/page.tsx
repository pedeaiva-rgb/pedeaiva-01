import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getStoreMenu } from "@/lib/menu";
import { AddToCart } from "../../produto/[id]/add-to-cart";

export async function generateMetadata({ params }: PageProps<"/[slug]/pizza/[sizeId]">): Promise<Metadata> {
  const { slug, sizeId } = await params;
  const size = (await getStoreMenu(slug))?.sizes.find((s) => s.id === sizeId);
  return { title: size ? `Pizza ${size.name}` : "Monte sua pizza" };
}

/** Pizza pelo tamanho: o cliente escolhe o tamanho na vitrine e aqui escolhe os sabores. */
export default async function PizzaBySizePage({ params }: PageProps<"/[slug]/pizza/[sizeId]">) {
  const { slug, sizeId } = await params;
  const menu = await getStoreMenu(slug);
  const size = menu?.sizes.find((s) => s.id === sizeId);
  if (!menu || !size) notFound();
  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/${slug}`} aria-label="Voltar ao cardápio" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface shadow-[var(--shadow-soft)]">
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <p className="eyebrow mt-4">Monte sua pizza</p>
      <h1 className="mt-1 text-3xl font-extrabold md:text-4xl">Pizza {size.name}</h1>
      <p className="mt-1 text-muted">
        {size.description ? `${size.description} · ` : ""}
        {size.max_flavors > 1 ? `escolha até ${size.max_flavors} sabores` : "escolha 1 sabor"}
      </p>
      <AddToCart slug={slug} menu={menu} sizeId={size.id} />
    </div>
  );
}
