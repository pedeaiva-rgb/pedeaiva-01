/** Contas de mapa sem serviço externo: distância, tempo estimado e ordem das paradas. */
export type LatLng = { lat: number; lng: number };

/** Distância em linha reta, em km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Minutos de moto na cidade: linha reta × 1,4 (as ruas não são retas) a 22 km/h, no mínimo 2. */
export function etaMinutes(km: number): number {
  return Math.max(2, Math.round(((km * 1.4) / 22) * 60));
}

/**
 * Ordem sugerida das entregas: sai do ponto inicial e vai sempre para a parada mais perto.
 * Paradas sem ponto no mapa ficam no fim, na ordem em que vieram.
 */
export function planRoute<T>(start: LatLng | null, stops: T[], at: (s: T) => LatLng | null): T[] {
  const located = stops.filter((s) => at(s));
  const rest = stops.filter((s) => !at(s));
  if (!start || located.length < 2) return [...located, ...rest];
  const out: T[] = [];
  let here = start;
  const left = [...located];
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (distanceKm(here, at(left[i]!)!) < distanceKm(here, at(left[best]!)!)) best = i;
    const [next] = left.splice(best, 1);
    out.push(next!);
    here = at(next!)!;
  }
  return [...out, ...rest];
}

/** Rota com várias paradas no Google Maps (até 9 paradas no meio do caminho). */
export function googleRouteUrl(addresses: string[]): string | null {
  const list = addresses.filter(Boolean);
  if (!list.length) return null;
  const dest = list[list.length - 1]!;
  const mid = list.slice(0, -1).slice(0, 9);
  const u = new URL("https://www.google.com/maps/dir/");
  u.searchParams.set("api", "1");
  u.searchParams.set("travelmode", "driving");
  u.searchParams.set("destination", dest);
  if (mid.length) u.searchParams.set("waypoints", mid.join("|"));
  return u.toString();
}

export const formatKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace(".", ",")} km`);
