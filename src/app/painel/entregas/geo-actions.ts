"use server";

import { blankNumber, customerQueries } from "@/lib/address-key";
import { lookupPoint, rememberPoint, storeCity } from "@/lib/address-points";
import { distanceKm, type LatLng } from "@/lib/geo";
import { addressQueries, geocodeFirst, googleGeocode, hasGoogle, pause } from "@/lib/geocode";
import { adminClient } from "@/lib/supabase/admin";
import { createClient, getUser } from "@/lib/supabase/server";
import { ACCESS, hasRole } from "@/lib/tenant";
import type { Address } from "@/lib/types";

export type GeoResult = { updated: number; store: boolean };

/** Endereço de cliente achado a mais de 15 km da loja não é dele: é outro lugar com o mesmo nome. */
const MAX_KM = 15;

/**
 * Coloca no mapa a loja e os endereços das entregas em andamento que ainda não têm ponto.
 * Primeiro usa os endereços que a loja já conhece; depois o Google (se tiver chave) e o mapa gratuito.
 */
export async function ensureGeocoded(pizzeriaId: string): Promise<GeoResult> {
  if (!(await hasRole(pizzeriaId, [...ACCESS.entregas, ...ACCESS.entregador]))) return { updated: 0, store: false };
  const admin = adminClient();
  const { data: pz } = await admin.from("pizzerias").select("address, lat, lng").eq("id", pizzeriaId).single();
  if (!pz) return { updated: 0, store: false };

  let store: LatLng | null = pz.lat != null && pz.lng != null ? { lat: pz.lat, lng: pz.lng } : null;
  if (!store && pz.address) {
    store = (await googleGeocode(pz.address))?.pos ?? (await geocodeFirst(addressQueries(pz.address)))?.pos ?? null;
    if (store) await admin.from("pizzerias").update({ lat: store.lat, lng: store.lng }).eq("id", pizzeriaId);
    return { updated: 0, store: !!store };
  }
  // Sem saber onde fica a loja, não arrisca: "Rua A, Centro" existe em muitas cidades.
  if (!store) return { updated: 0, store: false };
  const city = storeCity(pz.address);

  const { data: orders } = await admin
    .from("orders")
    .select("id, address")
    .eq("pizzeria_id", pizzeriaId)
    .eq("fulfillment", "entrega")
    .in("status", ["confirmado", "preparo", "pronto", "saiu"])
    .is("geo_status", null)
    .not("address", "is", null)
    .order("created_at")
    .limit(2);

  let updated = 0;
  let asked = false;
  for (const o of (orders ?? []) as { id: string; address: Address }[]) {
    const a = o.address;
    const known = await lookupPoint(pizzeriaId, a);
    let pos: LatLng | null = known?.pos ?? null;
    let status: "ok" | "aproximado" | "falhou" = known ? (known.exact ? "ok" : "aproximado") : "falhou";
    if (!known && hasGoogle()) {
      // Google primeiro: rua e número; se não achar a rua, o condomínio do complemento.
      const num = blankNumber(a.number) ? "" : `, ${a.number}`;
      const c = city ? `, ${city}` : "";
      let g = await googleGeocode(`${a.street}${num} - ${a.neighborhood}${c}`, store, MAX_KM);
      if (!g?.precise && a.complement?.trim()) g = (await googleGeocode(`${a.complement}, ${a.neighborhood}${c}`, store, MAX_KM)) ?? g;
      if (g) {
        pos = g.pos;
        status = g.precise ? "ok" : "aproximado";
      }
    }
    if (!pos) {
      if (asked) await pause(1100);
      asked = true;
      const { queries, exact } = customerQueries(a, city);
      const hit = await geocodeFirst(queries, store, MAX_KM);
      pos = hit?.pos ?? null;
      status = !hit ? "falhou" : hit.index < exact ? "ok" : "aproximado";
    }
    await admin.from("orders").update({ dest_lat: pos?.lat ?? null, dest_lng: pos?.lng ?? null, geo_status: status }).eq("id", o.id);
    updated++;
  }
  return { updated, store: true };
}

/** O dono marca no mapa onde fica a loja (quando o endereço não é achado ou ficou impreciso). */
export async function setStoreLocation(pizzeriaId: string, pos: LatLng): Promise<{ ok: boolean; message: string }> {
  const { data: ok } = await (await createClient()).rpc("manager_can", { _pz: pizzeriaId, _perm: "configuracoes" });
  if (ok !== true) return { ok: false, message: "Você não tem permissão para isso." };
  if (!(Math.abs(pos.lat) <= 90 && Math.abs(pos.lng) <= 180)) return { ok: false, message: "Ponto inválido." };
  const { error } = await adminClient().from("pizzerias").update({ lat: pos.lat, lng: pos.lng }).eq("id", pizzeriaId);
  return error ? { ok: false, message: "Não foi possível salvar o ponto." } : { ok: true, message: "Ponto da loja salvo" };
}

/**
 * Corrige o ponto de uma entrega (a loja tocando no mapa, ou o entregador na porta do cliente).
 * O ponto fica guardado: o próximo pedido do mesmo endereço já sai certo.
 */
export async function setOrderLocation(orderId: string, pos: LatLng): Promise<{ ok: boolean; message: string }> {
  if (!(Math.abs(pos.lat) <= 90 && Math.abs(pos.lng) <= 180)) return { ok: false, message: "Ponto inválido." };
  const user = await getUser();
  if (!user) return { ok: false, message: "Faça login de novo." };
  // A leitura com a sessão da pessoa já respeita quem pode ver o pedido.
  const sb = await createClient();
  const { data: o } = await sb.from("orders").select("id, pizzeria_id, courier_id, address, fulfillment").eq("id", orderId).maybeSingle();
  if (!o || o.fulfillment !== "entrega" || !o.address) return { ok: false, message: "Pedido não encontrado." };
  const staff = await hasRole(o.pizzeria_id, ACCESS.entregas);
  if (!staff) {
    const { data: me } = await sb.from("couriers").select("id").eq("pizzeria_id", o.pizzeria_id).eq("user_id", user.id).maybeSingle();
    if (!me || me.id !== o.courier_id) return { ok: false, message: "Você não tem permissão para isso." };
  }
  const admin = adminClient();
  const { data: pz } = await admin.from("pizzerias").select("lat, lng").eq("id", o.pizzeria_id).single();
  if (pz?.lat != null && pz.lng != null && distanceKm({ lat: pz.lat, lng: pz.lng }, pos) > 60) return { ok: false, message: "Esse ponto está longe demais da loja." };
  const { error } = await admin.from("orders").update({ dest_lat: pos.lat, dest_lng: pos.lng, geo_status: "ok" }).eq("id", orderId);
  if (error) return { ok: false, message: "Não foi possível salvar o ponto." };
  await rememberPoint(o.pizzeria_id, o.address as Address, pos, "ajuste");
  return { ok: true, message: "Ponto da entrega corrigido e guardado para os próximos pedidos" };
}
