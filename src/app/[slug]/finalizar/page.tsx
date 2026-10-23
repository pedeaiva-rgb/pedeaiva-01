import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStoreMenu } from "@/lib/menu";
import { Checkout } from "./checkout";

export const metadata: Metadata = { title: "Finalizar pedido" };

export default async function CheckoutPage({ params }: PageProps<"/[slug]/finalizar">) {
  const { slug } = await params;
  const menu = await getStoreMenu(slug);
  if (!menu) notFound();
  const pz = menu.pizzeria;
  const neighborhoods = pz.delivery_mode === "bairro" ? [...new Set(menu.zones.flatMap((z) => z.neighborhoods))].sort((a, b) => a.localeCompare(b, "pt-BR")) : [];
  return (
    <Checkout
      slug={slug}
      store={{ name: pz.name, allow_delivery: pz.allow_delivery, allow_pickup: pz.allow_pickup, delivery_mode: pz.delivery_mode }}
      neighborhoods={neighborhoods}
    />
  );
}
