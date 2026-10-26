"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Award, Coins, Stamp } from "lucide-react";
import { toast } from "sonner";
import { Field, Panel, Spinner, Toggle } from "@/components/ui";
import { MoneyInput } from "@/components/ui/money-input";
import { dbError } from "@/lib/db-error";
import { brl, centsToInput, parseMoney } from "@/lib/money";
import { browserClient } from "@/lib/supabase/client";

export type LoyaltyProgram = {
  active: boolean;
  mode: "selos" | "cashback";
  stamps_needed: number;
  min_order_cents: number;
  reward_type: "valor" | "percentual";
  reward_value: number;
  cashback_pct: number;
  reward_days: number;
};
const DEFAULT: LoyaltyProgram = { active: false, mode: "selos", stamps_needed: 10, min_order_cents: 0, reward_type: "valor", reward_value: 20, cashback_pct: 5, reward_days: 60 };

/** Programa de fidelidade: cartão de selos ou cashback. O prêmio sempre vira um cupom pessoal do cliente. */
export function LoyaltyPanel({ pizzeriaId, program }: { pizzeriaId: string; program: LoyaltyProgram | null | undefined }) {
  const router = useRouter();
  const sb = browserClient();
  const p = program ?? DEFAULT;
  const [f, setF] = useState({
    active: p.active,
    mode: p.mode,
    stamps: String(p.stamps_needed),
    min: p.min_order_cents ? centsToInput(p.min_order_cents) : "",
    rtype: p.reward_type,
    rvalue: p.reward_type === "valor" ? centsToInput(Math.round(Number(p.reward_value) * 100)) : String(Number(p.reward_value)),
    pct: String(Number(p.cashback_pct)),
    days: String(p.reward_days),
  });
  const [busy, setBusy] = useState(false);

  if (program === undefined) {
    return (
      <Panel title="Programa de fidelidade" className="mt-4">
        <p className="text-sm">
          Falta rodar no Supabase o SQL <code className="rounded bg-sand px-1">20261026020000_clientes_fidelidade.sql</code>.
        </p>
      </Panel>
    );
  }

  const stamps = Number(f.stamps);
  const days = Number(f.days);
  const pct = Number(f.pct.replace(",", "."));
  const rvalue = f.rtype === "valor" ? (parseMoney(f.rvalue || "0") ?? 0) / 100 : Number(f.rvalue.replace(",", "."));
  const min = f.min.trim() ? parseMoney(f.min) : 0;
  const reward = f.rtype === "valor" ? `${brl(Math.round(rvalue * 100))} de desconto` : `${rvalue}% de desconto`;
  const summary =
    f.mode === "selos"
      ? `A cada ${stamps || "?"} pedidos entregues${min ? ` de pelo menos ${brl(min)}` : ""}, o cliente ganha um cupom de ${reward}, válido por ${days || "?"} dias.`
      : `Cada pedido entregue${min ? ` de pelo menos ${brl(min)}` : ""} devolve ${pct || "?"}% do valor em um cupom para o próximo pedido, válido por ${days || "?"} dias.`;

  const save = async () => {
    if (f.mode === "selos" && !(Number.isInteger(stamps) && stamps >= 2 && stamps <= 50)) return toast.error("O cartão precisa de 2 a 50 pedidos.");
    if (f.mode === "selos" && (!(rvalue > 0) || (f.rtype === "percentual" && rvalue > 100))) return toast.error("Informe o prêmio.");
    if (f.mode === "cashback" && !(pct > 0 && pct <= 50)) return toast.error("O cashback vai de 1% a 50%.");
    if (!(Number.isInteger(days) && days >= 7 && days <= 365)) return toast.error("A validade do prêmio vai de 7 a 365 dias.");
    if (min == null) return toast.error("Pedido mínimo inválido.");
    setBusy(true);
    const { error } = await sb.from("loyalty_programs").upsert({
      pizzeria_id: pizzeriaId,
      active: f.active,
      mode: f.mode,
      stamps_needed: f.mode === "selos" ? stamps : p.stamps_needed,
      min_order_cents: min,
      reward_type: f.rtype,
      reward_value: f.mode === "selos" ? rvalue : p.reward_value,
      cashback_pct: f.mode === "cashback" ? pct : p.cashback_pct,
      reward_days: days,
      updated_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) return void toast.error(dbError(error));
    toast.success(f.active ? "Programa de fidelidade ligado" : "Programa de fidelidade salvo (desligado)");
    router.refresh();
  };

  return (
    <Panel title="Programa de fidelidade" className="mt-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 text-sm">
          <div className="flex items-start justify-between gap-3 rounded-2xl border p-3">
            <div>
              <p className="flex items-center gap-1.5 font-bold">
                <Award className="h-4 w-4 text-tomato" /> Fidelidade ligada
              </p>
              <p className="text-xs text-muted">Quando ligado, conta sozinho a cada pedido entregue (loja online, PDV e telefone com o número do cliente).</p>
            </div>
            <Toggle checked={f.active} label="Fidelidade ligada" onChange={(v) => setF({ ...f, active: v })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="chip !justify-center !rounded-2xl !py-3" data-active={f.mode === "selos"} onClick={() => setF({ ...f, mode: "selos" })}>
              <Stamp className="h-4 w-4" /> Cartão de selos
            </button>
            <button type="button" className="chip !justify-center !rounded-2xl !py-3" data-active={f.mode === "cashback"} onClick={() => setF({ ...f, mode: "cashback" })}>
              <Coins className="h-4 w-4" /> Cashback
            </button>
          </div>
          {f.mode === "selos" ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Pedidos para ganhar">
                <input className="field" inputMode="numeric" value={f.stamps} onChange={(e) => setF({ ...f, stamps: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
              </Field>
              <Field label="Prêmio">
                <div className="flex gap-1">
                  <select className="field !w-auto !px-2" value={f.rtype} onChange={(e) => setF({ ...f, rtype: e.target.value as LoyaltyProgram["reward_type"], rvalue: "" })}>
                    <option value="valor">R$</option>
                    <option value="percentual">%</option>
                  </select>
                  {f.rtype === "valor" ? (
                    <MoneyInput value={f.rvalue} onChange={(v) => setF({ ...f, rvalue: v })} />
                  ) : (
                    <input className="field" inputMode="decimal" value={f.rvalue} onChange={(e) => setF({ ...f, rvalue: e.target.value.replace(/[^\d,.]/g, "").slice(0, 5) })} />
                  )}
                </div>
              </Field>
            </div>
          ) : (
            <Field label="Cashback (% do pedido)">
              <input className="field !w-28" inputMode="decimal" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value.replace(/[^\d,.]/g, "").slice(0, 5) })} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Pedido mínimo para contar">
              <MoneyInput value={f.min} onChange={(v) => setF({ ...f, min: v })} placeholder="sem mínimo" />
            </Field>
            <Field label="Prêmio vale por (dias)">
              <input className="field" inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
            </Field>
          </div>
          <button className="btn" disabled={busy} onClick={save}>
            {busy && <Spinner className="h-4 w-4" />} Salvar fidelidade
          </button>
        </div>
        <div className="space-y-2 rounded-2xl bg-sand/60 p-4 text-sm">
          <p className="font-bold">Como fica para o cliente</p>
          <p>{summary}</p>
          <ul className="space-y-1 text-xs text-muted">
            <li>• O prêmio é um cupom só dele (código único, uso único). Ninguém usa o prêmio de outra pessoa.</li>
            <li>• Ele vê o progresso e o cupom na página de acompanhamento do pedido.</li>
            <li>• Você também vê e manda o cupom pelo WhatsApp na ficha do cliente, em Clientes.</li>
            <li>• Pedido cancelado não conta. Mesas sem telefone do cliente não entram.</li>
          </ul>
        </div>
      </div>
    </Panel>
  );
}
