import Link from "next/link";
import { notFound } from "next/navigation";
import { Bike, Clock, MapPin, Phone, Store } from "lucide-react";
import { CartBar } from "@/components/store/cart-button";
import { ProductImage } from "@/components/store/product-image";
import { storeStatus } from "@/lib/hours";
import { getStoreMenu } from "@/lib/menu";
import { brl } from "@/lib/money";
import { sellable, startingPrice } from "@/lib/pricing";
import type { Menu } from "@/lib/types";

function deliveryLine(menu: Menu) {
  const pz = menu.pizzeria;
  const parts: string[] = [];
  if (pz.allow_delivery) {
    if (pz.delivery_mode === "fixa") parts.push(pz.delivery_fee_cents === 0 ? "Entrega grátis" : `Entrega ${brl(pz.delivery_fee_cents)}`);
    else parts.push(menu.zones.length ? "Taxa de entrega por bairro" : "Entrega em configuração");
  }
  if (pz.allow_pickup) parts.push("Retirada no balcão");
  return parts.join(" · ") || "Consulte a loja";
}

export default async function StorePage({ params }: PageProps<"/[slug]">) {
  const { slug } = await params;
  const menu = await getStoreMenu(slug);
  if (!menu) notFound();
  const pz = menu.pizzeria;
  const status = storeStatus(pz);
  const visible = menu.products.filter((p) => sellable(p) && (!p.is_pizza || startingPrice(p, menu.prices) != null));
  const sections = menu.categories.map((c) => ({ ...c, products: visible.filter((p) => p.category_id === c.id) })).filter((c) => c.products.length > 0);
  const featured = visible.filter((p) => p.featured).slice(0, 4);

  return (
    <>
      <section className="relative overflow-hidden rounded-[1.75rem] bg-charcoal p-6 text-cream md:p-10">
        <div className="absolute -top-16 -right-10 h-56 w-56 rounded-full bg-tomato/25 blur-2xl" aria-hidden="true" />
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${status.open ? "bg-success text-paper" : "bg-graphite text-cream"}`}>
          <span className={`h-2 w-2 rounded-full ${status.open ? "bg-paper" : "bg-dende"}`} /> {status.open ? "Aberta para pedidos" : "Fechada agora"}
        </span>
        <h1 className="relative mt-4 text-4xl leading-none font-extrabold md:text-6xl">{pz.name}</h1>
        {pz.description && <p className="relative mt-3 max-w-xl text-sm text-cream/80 md:text-base">{pz.description}</p>}
        <div className="relative mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-cream/80">
          <span className="flex items-center gap-1.5">
            <Bike className="h-4 w-4 text-dende" /> {deliveryLine(menu)}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-dende" /> Preparo de cerca de {pz.prep_minutes} min
          </span>
          {pz.address && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-dende" /> {pz.address}
            </span>
          )}
          {pz.phone && (
            <a href={`tel:${pz.phone}`} className="flex items-center gap-1.5 underline-offset-4 hover:underline">
              <Phone className="h-4 w-4 text-dende" /> {pz.phone}
            </a>
          )}
        </div>
      </section>

      {!status.open && (
        <p role="status" className="mt-4 rounded-2xl bg-dende-soft p-4 text-sm font-semibold text-warning">
          {status.message} Você pode ver o cardápio, mas novos pedidos não estão sendo aceitos.
        </p>
      )}

      {sections.length === 0 ? (
        <div className="card mt-6 p-10 text-center">
          <Store className="mx-auto h-10 w-10 text-tomato" />
          <p className="mt-3 font-bold">O cardápio está sendo preparado</p>
          <p className="text-sm text-muted">Volte em breve!</p>
        </div>
      ) : (
        <>
          <nav aria-label="Categorias" className="sticky top-[68px] z-20 -mx-4 mt-5 flex gap-2 overflow-x-auto bg-background/90 px-4 py-2 backdrop-blur">
            {sections.map((c) => (
              <a key={c.id} href={`#cat-${c.id}`} className="chip shrink-0">
                {c.name}
              </a>
            ))}
          </nav>

          {featured.length > 0 && (
            <section className="mt-4">
              <p className="eyebrow">Destaques da casa</p>
              <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
                {featured.map((p) => (
                  <ProductCard key={p.id} slug={slug} menu={menu} id={p.id} />
                ))}
              </div>
            </section>
          )}

          {sections.map((c) => (
            <section key={c.id} id={`cat-${c.id}`} className="mt-8 scroll-mt-32">
              <h2 className="text-2xl font-extrabold">{c.name}</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {c.products.map((p) => (
                  <ProductRow key={p.id} slug={slug} menu={menu} id={p.id} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
      <CartBar slug={slug} />
    </>
  );
}

function ProductCard({ slug, menu, id }: { slug: string; menu: Menu; id: string }) {
  const p = menu.products.find((x) => x.id === id)!;
  const price = startingPrice(p, menu.prices)!;
  return (
    <Link href={`/${slug}/produto/${p.id}`} className="card flex flex-col p-3 transition hover:-translate-y-0.5">
      <ProductImage src={p.image_url} alt={p.name} size={240} className="w-full" />
      <p className="mt-2 line-clamp-1 text-sm font-bold">{p.name}</p>
      <p className="text-sm font-extrabold text-tomato">
        {p.is_pizza && <span className="text-[11px] font-semibold text-muted">a partir de </span>}
        {brl(price)}
      </p>
    </Link>
  );
}

function ProductRow({ slug, menu, id }: { slug: string; menu: Menu; id: string }) {
  const p = menu.products.find((x) => x.id === id)!;
  const price = startingPrice(p, menu.prices)!;
  return (
    <Link href={`/${slug}/produto/${p.id}`} className="card flex items-center gap-4 p-3 transition hover:-translate-y-0.5">
      <div className="min-w-0 flex-1 pl-1">
        <p className="font-bold">{p.name}</p>
        {p.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{p.description}</p>}
        <p className="mt-2 text-sm font-extrabold">
          {p.is_pizza && <span className="text-[11px] font-semibold text-muted">a partir de </span>}
          {brl(price)}
        </p>
      </div>
      <ProductImage src={p.image_url} alt={p.name} size={96} className="w-24 shrink-0" />
    </Link>
  );
}
