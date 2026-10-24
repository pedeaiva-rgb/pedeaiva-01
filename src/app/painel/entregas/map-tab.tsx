"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { Bike, MapPin, MapPinOff } from "lucide-react";
import { LiveMap, type MapLine, type MapPoint } from "@/components/map/live-map";
import { Empty, Panel } from "@/components/ui";
import { minutesSince } from "@/lib/beep";
import { distanceKm, etaMinutes, formatKm, planRoute, type LatLng } from "@/lib/geo";
import { browserClient } from "@/lib/supabase/client";
import type { Courier, Order } from "@/lib/types";
import { ensureGeocoded } from "./geo-actions";
import { PinDrawer } from "./pin-drawer";

type Stop = Pick<Order, "id" | "number" | "status" | "customer_name" | "courier_id" | "dest_lat" | "dest_lng" | "geo_status" | "address">;
const destOf = (o: Stop): LatLng | null => (o.dest_lat != null && o.dest_lng != null ? { lat: o.dest_lat, lng: o.dest_lng } : null);
/** Posição de entregador com mais de 3 min sem atualizar é mostrada como "sem sinal". */
const STALE_MIN = 3;

/** Mapa ao vivo da loja: entregadores em rota, paradas na ordem sugerida e pedidos prontos esperando. */
export function MapTab({ pizzeriaId, orders, onGeocoded }: { pizzeriaId: string; orders: Stop[]; onGeocoded: () => Promise<void> }) {
  const sb = browserClient();
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [store, setStore] = useState<{ pos: LatLng | null; address: string | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [fixing, setFixing] = useState<Stop | null>(null);

  const fetchLive = useCallback(async () => {
    const [c, z] = await Promise.all([
      sb.from("couriers").select("*").eq("pizzeria_id", pizzeriaId),
      sb.from("pizzerias").select("lat, lng, address").eq("id", pizzeriaId).single(),
    ]);
    return {
      couriers: (c.data ?? []) as Courier[],
      store: z.data ? { pos: z.data.lat != null ? { lat: z.data.lat as number, lng: z.data.lng as number } : null, address: z.data.address as string | null } : null,
    };
  }, [sb, pizzeriaId]);
  const apply = useCallback((r: Awaited<ReturnType<typeof fetchLive>>) => {
    setCouriers(r.couriers);
    setStore(r.store);
    setNow(Date.now());
  }, []);
  const tick = useEffectEvent(async () => apply(await fetchLive()));
  // Localiza endereços novos e a própria loja (aos poucos: o serviço gratuito pede calma).
  const locate = useEffectEvent(async () => {
    const r = await ensureGeocoded(pizzeriaId);
    if (r.updated) await onGeocoded();
    if (r.store) apply(await fetchLive());
  });

  useEffect(() => {
    let alive = true;
    fetchLive().then((r) => alive && apply(r));
    const soon = setTimeout(() => void locate(), 0);
    const live = setInterval(() => void tick(), 10_000);
    const geo = setInterval(() => void locate(), 60_000);
    return () => {
      alive = false;
      clearTimeout(soon);
      clearInterval(live);
      clearInterval(geo);
    };
  }, [fetchLive, apply, pizzeriaId]);

  const active = orders.filter((o) => ["pronto", "saiu"].includes(o.status));
  const onRoute = couriers
    .map((c) => {
      const stops = active.filter((o) => o.courier_id === c.id && o.status === "saiu");
      const pos = c.last_lat != null && c.last_lng != null ? { lat: c.last_lat, lng: c.last_lng } : null;
      return { c, pos, stops: planRoute(pos ?? store?.pos ?? null, stops, destOf), seen: c.last_seen_at ? minutesSince(c.last_seen_at, now) : null };
    })
    .filter((r) => r.stops.length > 0);
  const waiting = active.filter((o) => o.status === "pronto");

  const points: MapPoint[] = [];
  const lines: MapLine[] = [];
  if (store?.pos) points.push({ id: "loja", kind: "store", ...store.pos, label: "Loja" });
  for (const r of onRoute) {
    if (r.pos) points.push({ id: `c-${r.c.id}`, kind: "courier", ...r.pos, label: `${r.c.name}${r.seen != null && r.seen >= STALE_MIN ? ` · sem sinal há ${r.seen} min` : ""}` });
    r.stops.forEach((o, i) => {
      const d = destOf(o);
      if (d) points.push({ id: o.id, kind: "stop", ...d, seq: i + 1, approx: o.geo_status === "aproximado", label: `#${o.number} · ${o.customer_name} (${r.c.name.split(" ")[0]})` });
    });
    const path = [r.pos, ...r.stops.map(destOf)].filter((p): p is LatLng => !!p);
    if (path.length > 1) lines.push({ id: r.c.id, points: path.map((p) => [p.lat, p.lng]) });
  }
  for (const o of waiting) {
    const d = destOf(o);
    if (d) points.push({ id: o.id, kind: "stop", ...d, approx: o.geo_status === "aproximado", label: `#${o.number} · pronto, esperando entregador` });
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        {store && !store.pos && (
          <p className="flex gap-2 rounded-2xl bg-dende-soft p-3 text-sm font-semibold text-warning">
            <MapPinOff className="h-5 w-5 shrink-0" />
            {store.address
              ? "Não achamos o endereço da loja no mapa. Em Configurações, escreva completo: rua, número, bairro e cidade."
              : "Informe o endereço completo da loja (rua, número, bairro e cidade) em Configurações para o mapa funcionar."}
          </p>
        )}
        <LiveMap points={points} lines={lines} height={480} />
        <p className="text-[11px] text-muted">
          🛵 entregador ao vivo · números = ordem sugerida das paradas · • = pronto esperando entregador · borda tracejada = endereço achado só pelo bairro. A posição
          só aparece enquanto o entregador está com a página aberta no celular.
        </p>
      </div>
      <div className="space-y-4">
        <Panel title="Na rua agora">
          {onRoute.length === 0 ? (
            <Empty>Nenhum entregador em rota.</Empty>
          ) : (
            <ul className="space-y-3 text-sm">
              {onRoute.map(({ c, pos, stops, seen }) => {
                const first = stops[0] && destOf(stops[0]);
                return (
                  <li key={c.id} className="rounded-2xl bg-sand/60 p-3">
                    <p className="flex items-center gap-1.5 font-bold">
                      <Bike className="h-4 w-4 text-tomato" /> {c.name}
                    </p>
                    <p className={`text-xs ${!pos || (seen != null && seen >= STALE_MIN) ? "text-warning" : "text-muted"}`}>
                      {!pos ? "Sem localização (página do entregador fechada ou GPS bloqueado)" : seen != null && seen >= STALE_MIN ? `Sem sinal há ${seen} min` : "Ao vivo"}
                      {pos && first ? ` · próxima parada a ${formatKm(distanceKm(pos, first))} (~${etaMinutes(distanceKm(pos, first))} min)` : ""}
                    </p>
                    <p className="mt-1 text-xs">
                      {stops.map((o, i) => `${i + 1}º #${o.number} ${o.address?.neighborhood ?? ""}`).join(" → ")}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Conferir pontos">
          {active.length === 0 ? (
            <Empty>Nenhuma entrega pronta ou em rota.</Empty>
          ) : (
            <ul className="divide-y text-sm">
              {active.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <b>#{o.number}</b> {o.address?.neighborhood}
                    <span className={`block text-xs ${o.geo_status === "ok" ? "text-success" : "text-warning"}`}>
                      {o.geo_status === "ok" ? "Ponto certo" : o.geo_status === "aproximado" ? "Aproximado (só o bairro)" : o.geo_status === "falhou" ? "Endereço não achado no mapa" : "Localizando…"}
                    </span>
                  </span>
                  <button className={`${o.geo_status === "ok" ? "btn-ghost" : "btn"} !px-3 !py-1.5 text-xs`} onClick={() => setFixing(o)}>
                    <MapPin className="h-3.5 w-3.5" /> {o.geo_status === "ok" ? "Ajustar" : "Corrigir"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {fixing && <PinDrawer order={fixing} store={store?.pos ?? null} onClose={() => setFixing(null)} onSaved={onGeocoded} />}
      </div>
    </div>
  );
}
