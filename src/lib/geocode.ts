import "server-only";
import type { LatLng } from "./geo";

/**
 * Endereço → ponto no mapa pelo Nominatim (OpenStreetMap), gratuito.
 * Regras de uso: identificar o app e no máximo 1 consulta por segundo (quem chama espera entre elas).
 * Com `near`, só aceita resultado até ~35 km da loja (evita cair numa rua de mesmo nome em outra cidade).
 */
export async function geocode(query: string, near?: LatLng | null): Promise<LatLng | null> {
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
    return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  } catch {
    return null;
  }
}

export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tenta as consultas em ordem (1 por segundo) e devolve o primeiro ponto achado e qual consulta deu certo. */
export async function geocodeFirst(queries: string[], near?: LatLng | null): Promise<{ pos: LatLng; index: number } | null> {
  for (const [i, q] of queries.entries()) {
    if (i) await pause(1100);
    const pos = await geocode(q, near);
    if (pos) return { pos, index: i };
  }
  return null;
}

export { addressQueries } from "./address-queries";
