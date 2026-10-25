import "server-only";
import { distanceKm, type LatLng } from "./geo";

/**
 * Endereço → ponto no mapa pelo Nominatim (OpenStreetMap), gratuito.
 * Regras de uso: identificar o app e no máximo 1 consulta por segundo (quem chama espera entre elas).
 * Com `near`, só aceita resultado até ~35 km da loja (evita cair numa rua de mesmo nome em outra cidade).
 */
export async function geocode(query: string, near?: LatLng | null, maxKm = 40): Promise<LatLng | null> {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("q", query);
  u.searchParams.set("countrycodes", "br");
  u.searchParams.set("limit", "1");
  u.searchParams.set("accept-language", "pt-BR");
  if (near) {
    const d = 0.35;
    u.searchParams.set("viewbox", `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
    u.searchParams.set("bounded", "1");
  }
  try {
    const res = await fetch(u, {
      headers: { "User-Agent": "PedeAiEVa/1.0 (+https://pede-ai-e-va.vercel.app)" },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const [hit] = (await res.json()) as { lat: string; lon: string }[];
    if (!hit) return null;
    const pos = { lat: Number(hit.lat), lng: Number(hit.lon) };
    // Longe demais da loja: é outro lugar com o mesmo nome.
    return near && distanceKm(near, pos) > maxKm ? null : pos;
  } catch {
    return null;
  }
}

export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tenta as consultas em ordem (1 por segundo) e devolve o primeiro ponto achado e qual consulta deu certo. */
export async function geocodeFirst(queries: string[], near?: LatLng | null, maxKm = 40): Promise<{ pos: LatLng; index: number } | null> {
  for (const [i, q] of queries.entries()) {
    if (i) await pause(1100);
    const pos = await geocode(q, near, maxKm);
    if (pos) return { pos, index: i };
  }
  return null;
}

export { addressQueries } from "./address-queries";

/** Chave do Google só do servidor (busca de endereços). Sem ela, fica só o mapa gratuito. */
export const hasGoogle = () => !!process.env.GOOGLE_MAPS_SERVER_KEY;

type GoogleHit = { geometry: { location: { lat: number; lng: number }; location_type: string }; types: string[]; partial_match?: boolean };

/**
 * Endereço → ponto pelo Google (conhece muito mais ruas e condomínios no Brasil).
 * `precise`: casa/número, rua ou condomínio; senão é só bairro ou cidade.
 */
export async function googleGeocode(address: string, near?: LatLng | null, maxKm = 40): Promise<{ pos: LatLng; precise: boolean } | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;
  const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  u.searchParams.set("address", address);
  u.searchParams.set("key", key);
  u.searchParams.set("language", "pt-BR");
  u.searchParams.set("region", "br");
  u.searchParams.set("components", "country:BR");
  if (near) u.searchParams.set("bounds", `${near.lat - 0.2},${near.lng - 0.2}|${near.lat + 0.2},${near.lng + 0.2}`);
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { status: string; results: GoogleHit[] };
    if (body.status !== "OK") {
      if (body.status !== "ZERO_RESULTS") console.error("Google Geocoding:", body.status);
      return null;
    }
    const hit = body.results[0]!;
    const pos = { lat: hit.geometry.location.lat, lng: hit.geometry.location.lng };
    if (near && distanceKm(near, pos) > maxKm) return null;
    const kind = hit.geometry.location_type;
    const precise =
      kind === "ROOFTOP" || kind === "RANGE_INTERPOLATED" || hit.types.some((t) => ["street_address", "premise", "subpremise", "route", "establishment", "point_of_interest"].includes(t));
    return { pos, precise };
  } catch {
    return null;
  }
}
