import "server-only";
import { addressKeys } from "./address-key";
import { addressQueries } from "./address-queries";
import type { LatLng } from "./geo";
import { adminClient } from "./supabase/admin";
import type { Address } from "./types";

/** Cidade da loja ("Camaçari, BA"), tirada do fim do endereço dela. */
export function storeCity(storeAddress: string | null): string | null {
  if (!storeAddress) return null;
  const q = addressQueries(storeAddress);
  return q.length > 1 ? q[q.length - 1]! : null;
}

/** Ponto já conhecido do endereço: exato ("ok") ou só da mesma rua ("aproximado"). */
export async function lookupPoint(pizzeriaId: string, a: Address): Promise<{ pos: LatLng; exact: boolean } | null> {
  const k = addressKeys(a);
  const keys = [k.full, k.street].filter((x): x is string => !!x);
  const { data } = await adminClient().from("address_points").select("key, lat, lng").eq("pizzeria_id", pizzeriaId).in("key", keys);
  const rows = (data ?? []) as { key: string; lat: number; lng: number }[];
  const hit = rows.find((r) => r.key === k.full) ?? rows.find((r) => r.key === k.street);
  return hit ? { pos: { lat: hit.lat, lng: hit.lng }, exact: hit.key === k.full || !k.full } : null;
}

/** Guarda o ponto certo do endereço (e da rua) para os próximos pedidos. */
export async function rememberPoint(pizzeriaId: string, a: Address, pos: LatLng, source: "cliente" | "ajuste") {
  const k = addressKeys(a);
  const now = new Date().toISOString();
  const rows = [k.full, k.street].filter((x): x is string => !!x).map((key) => ({ pizzeria_id: pizzeriaId, key, lat: pos.lat, lng: pos.lng, source, updated_at: now }));
  await adminClient().from("address_points").upsert(rows);
}
