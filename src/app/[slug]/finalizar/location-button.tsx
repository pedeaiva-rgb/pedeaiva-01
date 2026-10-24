"use client";

import { useState } from "react";
import { CheckCircle2, LocateFixed, X } from "lucide-react";
import { Spinner } from "@/components/ui";

export type PickedLocation = { lat: number; lng: number; accuracy: number };

/** "Estou no endereço da entrega": usa o GPS do celular para o entregador chegar no lugar exato. */
export function LocationButton({ value, onChange }: { value: PickedLocation | null; onChange: (v: PickedLocation | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = () => {
    if (!("geolocation" in navigator)) return setError("Seu navegador não informa a localização.");
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBusy(false);
        if (p.coords.accuracy > 150) return setError("A localização veio imprecisa. Tente de novo perto de uma janela ou com o GPS ligado.");
        onChange({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      (e) => {
        setBusy(false);
        setError(e.code === e.PERMISSION_DENIED ? "Você não liberou a localização. Tudo bem: o endereço digitado continua valendo." : "Não deu para pegar a localização agora.");
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  if (value) {
    return (
      <p className="flex items-center gap-2 rounded-2xl bg-success-soft px-3 py-2 text-xs font-semibold text-success">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span className="flex-1">Localização marcada (precisão de ~{Math.round(value.accuracy)} m). O entregador vai direto ao ponto.</span>
        <button type="button" aria-label="Tirar a localização" onClick={() => onChange(null)} className="text-muted hover:text-danger">
          <X className="h-4 w-4" />
        </button>
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <button type="button" className="btn-ghost w-full !py-2.5 text-sm" disabled={busy} onClick={ask}>
        {busy ? <Spinner className="h-4 w-4" /> : <LocateFixed className="h-4 w-4" />} Estou no endereço da entrega: usar minha localização
      </button>
      <p className="text-[11px] text-muted">Opcional. Ajuda o entregador a achar sua casa, principalmente em condomínio ou rua sem nome no mapa.</p>
      {error && <p className="text-xs font-semibold text-warning">{error}</p>}
    </div>
  );
}
