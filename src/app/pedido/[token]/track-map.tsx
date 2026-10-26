"use client";

import { useMemo } from "react";
import { LiveMap, type MapPoint } from "@/components/map/live-map";
import type { LatLng } from "@/lib/geo";

/** Mapa do acompanhamento: onde está o entregador agora (e a loja, de referência). */
export function TrackMap({ store, courier, courierName }: { store: LatLng | null; courier: LatLng; courierName: string | null }) {
  const points = useMemo<MapPoint[]>(
    () => [
      ...(store ? [{ id: "loja", kind: "store" as const, ...store, label: "Loja" }] : []),
      { id: "moto", kind: "courier" as const, lat: courier.lat, lng: courier.lng, label: courierName ?? "Entregador" },
    ],
    [store, courier.lat, courier.lng, courierName],
  );
  return <LiveMap points={points} height={260} />;
}
