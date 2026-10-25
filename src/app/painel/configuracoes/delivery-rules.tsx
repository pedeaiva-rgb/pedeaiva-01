"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Bike, MapPin } from "lucide-react";
import { toast } from "sonner";
import { LiveMap, type MapPoint } from "@/components/map/live-map";
import { Field, Panel, Spinner, Toggle } from "@/components/ui";
import { MoneyInput } from "@/components/ui/money-input";
import { dbError } from "@/lib/db-error";
import { LIVE_TRACKING } from "@/lib/features";
import type { LatLng } from "@/lib/geo";
import { centsToInput, parseMoney } from "@/lib/money";
import { COURIER_PAY_LABEL } from "@/lib/order-labels";
import { browserClient } from "@/lib/supabase/client";
import type { CourierPay, Pizzeria } from "@/lib/types";
import { setStoreLocation } from "../entregas/geo-actions";

/** Regras dos entregadores. Salva à parte do resto das configurações. */
export function DeliveryRules({ pizzeria: pz }: { pizzeria: Pizzeria }) {
  const router = useRouter();
  const sb = browserClient();
  const [f, setF] = useState({
    self: pz.couriers_self_assign ?? true,
    code: pz.require_delivery_code ?? true,
    mode: (pz.courier_pay_mode ?? "taxa") as CourierPay,
    fixed: centsToInput(pz.courier_pay_fixed_cents ?? 0),
  });
  const [busy, setBusy] = useState(false);
  const missing = pz.courier_pay_mode === undefined;

  const save = async () => {
    const fixed = parseMoney(f.fixed || "0");
    if (fixed == null || fixed > 100000) return toast.error("Valor por entrega inválido.");
    setBusy(true);
    const { error } = await sb
      .from("pizzerias")
      .update({ couriers_self_assign: f.self, require_delivery_code: f.code, courier_pay_mode: f.mode, courier_pay_fixed_cents: fixed })
      .eq("id", pz.id);
    setBusy(false);
    if (error) return toast.error(dbError(error));
    toast.success("Regras dos entregadores salvas");
    router.refresh();
  };

  return (
    <Panel title="Entregadores" className="mt-4">
      {missing ? (
        <p className="text-sm">
          Falta rodar no Supabase o SQL <code className="rounded bg-sand px-1">20261024020000_painel_entregador.sql</code>.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="block font-semibold">Entregador pode pegar pedido sozinho</span>
              <span className="text-xs text-muted">Pedidos prontos aparecem para todos os entregadores; o primeiro que pegar leva. A loja continua podendo direcionar.</span>
            </span>
            <Toggle checked={f.self} label="Entregador pega pedido sozinho" onChange={(v) => setF({ ...f, self: v })} />
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="block font-semibold">Exigir código de entrega</span>
              <span className="text-xs text-muted">O cliente recebe 4 números no WhatsApp e no acompanhamento; o entregador digita para confirmar a entrega.</span>
            </span>
            <Toggle checked={f.code} label="Exigir código de entrega" onChange={(v) => setF({ ...f, code: v })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Quanto o entregador ganha por entrega (padrão)">
              <select className="field" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as CourierPay })}>
                {(Object.keys(COURIER_PAY_LABEL) as CourierPay[]).map((k) => (
                  <option key={k} value={k}>
                    {COURIER_PAY_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            {f.mode !== "taxa" && (
              <Field label="Valor fixo por entrega">
                <MoneyInput value={f.fixed} onChange={(v) => setF({ ...f, fixed: v })} />
              </Field>
            )}
          </div>
          <p className="text-xs text-muted">Dá para combinar um valor diferente com cada entregador em Entregas → Entregadores.</p>
          <button className="btn" disabled={busy} onClick={save}>
            {busy ? <Spinner className="h-4 w-4" /> : <Bike className="h-4 w-4" />} Salvar regras dos entregadores
          </button>
          {LIVE_TRACKING && <StorePin pizzeriaId={pz.id} initial={pz.lat != null && pz.lng != null ? { lat: pz.lat, lng: pz.lng } : null} hasAddress={!!pz.address} />}
        </div>
      )}
    </Panel>
  );
}

/** Ponto da loja no mapa: base para achar os endereços dos clientes e para a rota dos entregadores. */
function StorePin({ pizzeriaId, initial, hasAddress }: { pizzeriaId: string; initial: LatLng | null; hasAddress: boolean }) {
  const router = useRouter();
  const [pos, setPos] = useState<LatLng | null>(initial);
  const [busy, setBusy] = useState(false);
  const points = useMemo<MapPoint[]>(() => (pos ? [{ id: "loja", kind: "store", ...pos, label: "Loja" }] : []), [pos]);
  const dirty = pos != null && (pos.lat !== initial?.lat || pos.lng !== initial?.lng);
  const save = async () => {
    if (!pos) return;
    setBusy(true);
    const r = await setStoreLocation(pizzeriaId, pos);
    setBusy(false);
    if (r.ok) {
      toast.success(r.message);
      router.refresh();
    } else toast.error(r.message);
  };
  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-sm font-semibold">Ponto da loja no mapa</p>
      <p className="text-xs text-muted">
        {initial
          ? "Confira se o ícone 🍕 está no lugar certo. Se não estiver, toque no mapa em cima da loja e salve."
          : hasAddress
            ? "Ainda não achamos a loja pelo endereço. Aproxime o mapa, toque em cima da loja e salve."
            : "Preencha o endereço da loja acima ou toque no mapa em cima da loja e salve."}{" "}
        É a partir daqui que o sistema acha os endereços dos clientes e monta a rota.
      </p>
      <LiveMap points={points} height={280} onPick={setPos} />
      {dirty && (
        <button className="btn-dark !py-2 text-sm" disabled={busy} onClick={save}>
          {busy ? <Spinner className="h-4 w-4" /> : <MapPin className="h-4 w-4" />} Salvar ponto da loja
        </button>
      )}
    </div>
  );
}
