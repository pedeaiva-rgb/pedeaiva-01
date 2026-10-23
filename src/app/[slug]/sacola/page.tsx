import type { Metadata } from "next";
import { CartView } from "./cart-view";

export const metadata: Metadata = { title: "Sua sacola" };

export default async function CartPage({ params }: PageProps<"/[slug]/sacola">) {
  const { slug } = await params;
  return <CartView slug={slug} />;
}
