"use server";

import type { LatLng } from "@/lib/geo";
import { addressQueries, geocodeFirst, pause } from "@/lib/geocode";
import { adminClient } from "@/lib/supabase/admin";
import { ACCESS, hasRole } from "@/lib/tenant";
import type { Address } from "@/lib/types";

export type GeoResult = { updated: number; store: boolean };

/**
 * Coloca no mapa a loja e os endereços das entregas em andamento que ainda não têm ponto.
 * Faz poucas consultas por vez (o serviço gratuito pede calma); quem chama repete depois.
 */
export async function ensureGeocoded(pizzeriaId: string): Promise<GeoResult> {
  if (!(await hasRole(pizzeriaId, [...ACCESS.entregas, ...ACCESS.entregador]))) return { updated: 0, store: false };
  const admin = adminClient();
  const { data: pz } = await admin.from("pizzerias").select("address, lat, lng").eq("id", pizzeriaId).single();
  if (!pz) return { updated: 0, store: false };

  let store: LatLng | null = pz.lat != null && pz.lng != null ? { lat: pz.lat, lng: pz.lng } : null;
  if (!store && pz.address) {
    store = (await geocodeFirst(addressQueries(pz.address)))?.pos ?? null;
    if (store) await admin.from("pizzerias").update({ lat: store.lat, lng: store.lng }).eq("id", pizzeriaId);
    // Achou ou não, as consultas de pedidos ficam para a próxima rodada.
    return { updated: 0, store: !!store };
  }
  // Sem saber onde fica a loja, não arrisca: "Rua A, Centro" existe em muitas cidades.
  if (!store) return { updated: 0, store: false };

  const { data: orders } = await admin
    .from("orders")
    .select("id, address")
    .eq("pizzeria_id", pizzeriaId)
    .eq("fulfillment", "entrega")
    .in("status", ["confirmado", "preparo", "pronto", "saiu"])
    .is("geo_status", null)
    .not("address", "is", null)
    .order("created_at")
    .limit(3);

  let updated = 0;
  for (const o of (orders ?? []) as { id: string; address: Address }[]) {
    const a = o.address;
    if (updated) await pause(1100);
    // Rua com número → rua → bairro; sempre perto da loja.
    const hit = await geocodeFirst([`${a.street}, ${a.number}, ${a.neighborhood}`, `${a.street}, ${a.neighborhood}`, a.neighborhood], store);
    await admin
      .from("orders")
      .update({ dest_lat: hit?.pos.lat ?? null, dest_lng: hit?.pos.lng ?? null, geo_status: !hit ? "falhou" : hit.index < 2 ? "ok" : "aproximado" })
      .eq("id", o.id);
    updated++;
  }
  return { updated, store: true };
}

/** O dono marca no mapa onde fica a loja (quando o endereço não é achado ou ficou impreciso). */
export async function setStoreLocation(pizzeriaId: string, pos: LatLng): Promise<{ ok: boolean; message: string }> {
  if (!(await hasRole(pizzeriaId, ACCESS.configuracoes))) return { ok: false, message: "Você não tem permissão para isso." };
  if (!(Math.abs(pos.lat) <= 90 && Math.abs(pos.lng) <= 180)) return { ok: false, message: "Ponto inválido." };
  const { error } = await adminClient().from("pizzerias").update({ lat: pos.lat, lng: pos.lng }).eq("id", pizzeriaId);
  return error ? { ok: false, message: "Não foi possível salvar o ponto." } : { ok: true, message: "Ponto da loja salvo" };
}
