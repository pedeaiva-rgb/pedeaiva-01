"use client";

import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { Bike, MapPinOff } from "lucide-react";
import { LiveMap, type MapPoint } from "@/components/map/live-map";
import { Empty, Panel } from "@/components/ui";
import { minutesSince } from "@/lib/beep";
import type { LatLng } from "@/lib/geo";
import { browserClient } from "@/lib/supabase/client";
import type { Courier, Order } from "@/lib/types";

type Stop = Pick<Order, "id" | "number" | "status" | "customer_name" | "courier_id" | "address">;
/** Posição de entregador com mais de 3 min sem atualizar é mostrada como "sem sinal". */
const STALE_MIN = 3;

/** Mapa ao vivo da loja: onde estão os entregadores que saíram para entrega. */
export function MapTab({ pizzeriaId, orders }: { pizzeriaId: string; orders: Stop[] }) {
  const sb = browserClient();
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [store, setStore] = useState<{ pos: LatLng | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const fetchLive = useCallback(async () => {
    const [c, z] = await Promise.all([
      sb.from("couriers").select("*").eq("pizzeria_id", pizzeriaId),
      sb.from("pizzerias").select("lat, lng").eq("id", pizzeriaId).single(),
    ]);
    return {
      couriers: (c.data ?? []) as Courier[],
      store: z.data ? { pos: z.data.lat != null ? { lat: z.data.lat as number, lng: z.data.lng as number } : null } : null,
    };
  }, [sb, pizzeriaId]);
  const apply = useCallback((r: Awaited<ReturnType<typeof fetchLive>>) => {
    setCouriers(r.couriers);
    setStore(r.store);
    setNow(Date.now());
  }, []);
  const tick = useEffectEvent(async () => apply(await fetchLive()));

  useEffect(() => {
    let alive = true;
    fetchLive().then((r) => alive && apply(r));
    const live = setInterval(() => void tick(), 10_000);
    return () => {
      alive = false;
      clearInterval(live);
    };
  }, [fetchLive, apply]);

  const onRoute = couriers
    .map((c) => ({
      c,
      pos: c.last_lat != null && c.last_lng != null ? { lat: c.last_lat, lng: c.last_lng } : null,
      orders: orders.filter((o) => o.courier_id === c.id && o.status === "saiu"),
      seen: c.last_seen_at ? minutesSince(c.last_seen_at, now) : null,
    }))
    .filter((r) => r.orders.length > 0);

  const points: MapPoint[] = [];
  if (store?.pos) points.push({ id: "loja", kind: "store", ...store.pos, label: "Loja" });
  for (const r of onRoute) {
    if (!r.pos) continue;
    const late = r.seen != null && r.seen >= STALE_MIN;
    points.push({ id: `c-${r.c.id}`, kind: "courier", ...r.pos, label: `${r.c.name} · #${r.orders.map((o) => o.number).join(", #")}${late ? ` · sem sinal há ${r.seen} min` : ""}` });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        {store && !store.pos && (
          <p className="flex gap-2 rounded-2xl bg-dende-soft p-3 text-sm font-semibold text-warning">
            <MapPinOff className="h-5 w-5 shrink-0" /> Marque o ponto da loja em Configurações → Entregadores para o mapa abrir já na sua região.
          </p>
        )}
        <LiveMap points={points} height={480} />
        <p className="text-[11px] text-muted">
          🛵 = entregador em rota, ao vivo. A posição aparece enquanto o entregador está com a página de entregas aberta no celular e some quando ele termina as entregas.
        </p>
      </div>
      <Panel title="Na rua agora">
        {onRoute.length === 0 ? (
          <Empty>Nenhum entregador em rota.</Empty>
        ) : (
          <ul className="space-y-3 text-sm">
            {onRoute.map(({ c, pos, orders: list, seen }) => (
              <li key={c.id} className="rounded-2xl bg-sand/60 p-3">
                <p className="flex items-center gap-1.5 font-bold">
                  <Bike className="h-4 w-4 text-tomato" /> {c.name}
                </p>
                <p className={`text-xs ${!pos || (seen != null && seen >= STALE_MIN) ? "text-warning" : "text-success"}`}>
                  {!pos ? "Sem localização (página do entregador fechada ou GPS bloqueado)" : seen != null && seen >= STALE_MIN ? `Sem sinal há ${seen} min` : "Ao vivo"}
                </p>
                <p className="mt-1 text-xs">{list.map((o) => `#${o.number} ${o.address?.neighborhood ?? ""}`).join(" · ")}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
