"use client";

import { useMemo } from "react";
import { LiveMap, type MapPoint } from "@/components/map/live-map";
import type { LatLng } from "@/lib/geo";

/** Mapa do acompanhamento: onde está o entregador, a loja e a casa do cliente. */
export function TrackMap({ store, dest, courier, courierName }: { store: LatLng | null; dest: LatLng | null; courier: LatLng | null; courierName: string | null }) {
  const points = useMemo<MapPoint[]>(
    () => [
      ...(store ? [{ id: "loja", kind: "store" as const, ...store, label: "Pizzaria" }] : []),
      ...(dest ? [{ id: "casa", kind: "stop" as const, ...dest, seq: undefined, label: "Seu endereço" }] : []),
      ...(courier ? [{ id: "moto", kind: "courier" as const, ...courier, label: courierName ?? "Entregador" }] : []),
    ],
    [store, dest, courier, courierName],
  );
  const lines = useMemo(() => (courier && dest ? [{ id: "rota", points: [[courier.lat, courier.lng], [dest.lat, dest.lng]] as [number, number][] }] : undefined), [courier, dest]);
  if (!points.length) return null;
  return <LiveMap points={points} lines={lines} height={260} />;
}
