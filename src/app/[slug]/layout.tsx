import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CartButton } from "@/components/store/cart-button";
import { PavSymbol } from "@/components/brand/logo";
import { SetupNotice } from "@/components/setup-notice";
import { getStoreMenu } from "@/lib/menu";
import { supabaseConfigured } from "@/lib/supabase/env";

export async function generateMetadata({ params }: LayoutProps<"/[slug]">): Promise<Metadata> {
  if (!supabaseConfigured) return {};
  const { slug } = await params;
  const menu = await getStoreMenu(slug);
  if (!menu) return { title: "Loja não encontrada" };
  return {
    title: { default: menu.pizzeria.name, template: `%s · ${menu.pizzeria.name}` },
    description: menu.pizzeria.description || `Peça online na ${menu.pizzeria.name}.`,
  };
}

export default async function StoreLayout({ params, children }: LayoutProps<"/[slug]">) {
  if (!supabaseConfigured) return <SetupNotice />;
  const { slug } = await params;
  const menu = await getStoreMenu(slug);
  if (!menu) notFound();
  return (
    <div className="min-h-dvh pb-28">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href={`/${slug}`} className="min-w-0">
            <p className="truncate font-brand text-xl font-extrabold">{menu.pizzeria.name}</p>
          </Link>
          <CartButton slug={slug} />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-5">{children}</main>
      <footer className="mx-auto mt-12 flex max-w-5xl items-center justify-center gap-2 px-4 text-xs text-muted">
        <PavSymbol size={20} /> Loja feita com <Link href="/" className="font-bold text-ink">Pede aí e vá</Link>
      </footer>
    </div>
  );
}
