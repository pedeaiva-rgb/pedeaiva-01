"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bike } from "lucide-react";
import { toast } from "sonner";
import { Field, Panel, Spinner, Toggle } from "@/components/ui";
import { MoneyInput } from "@/components/ui/money-input";
import { dbError } from "@/lib/db-error";
import { centsToInput, parseMoney } from "@/lib/money";
import { COURIER_PAY_LABEL } from "@/lib/order-labels";
import { browserClient } from "@/lib/supabase/client";
import type { CourierPay, Pizzeria } from "@/lib/types";

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
        </div>
      )}
    </Panel>
  );
}
