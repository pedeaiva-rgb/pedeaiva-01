"use client";

import { useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { LiveMap, type MapPoint } from "@/components/map/live-map";
import { Drawer, Spinner } from "@/components/ui";
import type { LatLng } from "@/lib/geo";
import type { Order } from "@/lib/types";
import { setOrderLocation } from "./geo-actions";

export type PinOrder = Pick<Order, "id" | "number" | "customer_name" | "address" | "dest_lat" | "dest_lng" | "geo_status">;

/** Corrigir onde fica a entrega: toca no mapa e salva. O sistema guarda para o próximo pedido do endereço. */
export function PinDrawer({ order: o, store, onClose, onSaved }: { order: PinOrder; store: LatLng | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [pos, setPos] = useState<LatLng | null>(o.dest_lat != null && o.dest_lng != null ? { lat: o.dest_lat, lng: o.dest_lng } : null);
  const [busy, setBusy] = useState(false);
  const points = useMemo<MapPoint[]>(
    () => [
      ...(store ? [{ id: "loja", kind: "store" as const, ...store, label: "Loja" }] : []),
      ...(pos ? [{ id: "casa", kind: "stop" as const, ...pos, seq: o.number, label: `#${o.number} · ${o.customer_name}` }] : []),
    ],
    [store, pos, o.number, o.customer_name],
  );
  const save = async () => {
    if (!pos) return;
    setBusy(true);
    const r = await setOrderLocation(o.id, pos);
    setBusy(false);
    if (!r.ok) return void toast.error(r.message);
    toast.success(r.message);
    await onSaved();
    onClose();
  };
  return (
    <Drawer title={`Ponto da entrega #${o.number}`} onClose={onClose} wide>
      <div className="space-y-3 text-sm">
        {o.address && (
          <p>
            <b>
              {o.address.street}, {o.address.number}
            </b>
            {o.address.complement ? ` – ${o.address.complement}` : ""} — {o.address.neighborhood}
            {o.address.reference && <span className="block text-xs text-muted">Referência: {o.address.reference}</span>}
          </p>
        )}
        <p className="text-xs text-muted">
          {o.geo_status === "ok" ? "Ponto atual marcado no mapa." : o.geo_status === "aproximado" ? "O ponto atual é só aproximado (pelo bairro)." : "O mapa não achou este endereço."} Aproxime o
          mapa, toque no lugar certo da casa e salve. Os próximos pedidos deste endereço já saem certos.
        </p>
        <LiveMap points={points} height={420} onPick={setPos} />
        <button className="btn w-full" disabled={busy || !pos} onClick={save}>
          {busy ? <Spinner className="h-4 w-4" /> : <MapPin className="h-4 w-4" />} Salvar ponto da entrega
        </button>
      </div>
    </Drawer>
  );
}
