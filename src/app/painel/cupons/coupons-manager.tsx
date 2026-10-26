"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Megaphone, Plus, Ticket, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Empty, Field, PageHeader, Panel, Spinner, Toggle } from "@/components/ui";
import { MoneyInput } from "@/components/ui/money-input";
import { dbError } from "@/lib/db-error";
import { brl, parseMoney } from "@/lib/money";
import { normalizeCouponCode } from "@/lib/pricing";
import { browserClient } from "@/lib/supabase/client";
import type { Coupon } from "@/lib/types";

const EMPTY = { code: "", type: "percentual" as Coupon["discount_type"], value: "", min: "", maxUses: "", start: "", end: "", show: false, first: false, description: "" };
const dateBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
/** Data do campo (AAAA-MM-DD) no começo ou no fim do dia em São Paulo. */
const spDay = (d: string, end: boolean) => (d ? new Date(`${d}T${end ? "23:59:59" : "00:00:00"}-03:00`).toISOString() : null);

function describe(c: Coupon) {
  const off = c.discount_type === "percentual" ? `${Number(c.value)}% de desconto` : `${brl(Math.round(Number(c.value) * 100))} de desconto`;
  const parts = [off];
  if (c.min_order_cents > 0) parts.push(`pedido mínimo ${brl(c.min_order_cents)}`);
  if (c.starts_at) parts.push(`a partir de ${dateBR(c.starts_at)}`);
  if (c.ends_at) parts.push(`até ${dateBR(c.ends_at)}`);
  if (c.first_order_only) parts.push("só na primeira compra");
  return parts.join(" · ");
}

function situation(c: Coupon) {
  const now = Date.now();
  if (!c.active) return { label: "Pausado", cls: "bg-sand text-muted" };
  if (c.max_uses != null && c.uses >= c.max_uses) return { label: "Esgotado", cls: "bg-sand text-muted" };
  if (c.ends_at && new Date(c.ends_at).getTime() < now) return { label: "Expirado", cls: "bg-sand text-muted" };
  if (c.starts_at && new Date(c.starts_at).getTime() > now) return { label: "Agendado", cls: "bg-info-soft text-info" };
  return { label: "Valendo", cls: "bg-success-soft text-success" };
}

export function CouponsManager({ pizzeriaId, coupons, personal }: { pizzeriaId: string; coupons: Coupon[]; personal: { active: number; used: number } }) {
  const router = useRouter();
  const sb = browserClient();
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k: Exclude<keyof typeof EMPTY, "show" | "first">) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const run = async (fn: () => PromiseLike<{ error: unknown }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      toast.error(dbError(error));
      return false;
    }
    toast.success(ok);
    router.refresh();
    return true;
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = normalizeCouponCode(f.code);
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return toast.error("O código precisa ter de 3 a 30 letras, números, hífen ou sublinhado, sem espaços.");
    // Em R$ o campo vem como "1.234,56"; em % vem como "10" ou "12,5".
    const value = f.type === "valor" ? (parseMoney(f.value || "0") ?? 0) / 100 : Number(f.value.replace(",", "."));
    if (!(value > 0)) return toast.error("Informe o valor do desconto.");
    if (f.type === "percentual" && value > 100) return toast.error("O desconto em porcentagem vai até 100%.");
    const min = f.min.trim() ? parseMoney(f.min) : 0;
    if (min == null) return toast.error("Pedido mínimo inválido.");
    const maxUses = f.maxUses.trim() ? Number(f.maxUses) : null;
    if (maxUses != null && !(Number.isInteger(maxUses) && maxUses > 0)) return toast.error("O limite de usos precisa ser um número inteiro maior que zero.");
    if (f.start && f.end && f.end < f.start) return toast.error("A data final precisa ser igual ou depois da inicial.");
    const ok = await run(
      () =>
        sb.from("coupons").insert({
          pizzeria_id: pizzeriaId,
          code,
          discount_type: f.type,
          value,
          min_order_cents: min,
          max_uses: maxUses,
          starts_at: spDay(f.start, false),
          ends_at: spDay(f.end, true),
          show_in_store: f.show,
          first_order_only: f.first,
          description: f.description.trim(),
        }),
      `Cupom ${code} criado`,
    );
    if (ok) setF(EMPTY);
  };

  return (
    <>
      <PageHeader title="Cupons" subtitle="O cliente digita o código no checkout. O desconto vale sobre os itens, antes da taxa de entrega." />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Panel title="Seus cupons">
          {coupons.length === 0 ? (
            <Empty>Nenhum cupom ainda. Crie o primeiro ao lado (ex.: BEMVINDO com 10%).</Empty>
          ) : (
            <ul className="divide-y">
              {coupons.map((c) => {
                const s = situation(c);
                return (
                  <li key={c.id} className="flex items-center gap-3 py-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-charcoal text-dende">
                      <Ticket className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-mono font-bold">
                        {c.code}
                        <span className={`rounded-full px-2 py-0.5 font-sans text-[10px] font-bold ${s.cls}`}>{s.label}</span>
                      </p>
                      <p className="text-xs text-muted">{describe(c)}</p>
                      <p className="text-[11px] text-muted">
                        {c.uses} uso(s){c.max_uses != null ? ` de ${c.max_uses}` : ""}
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => sb.from("coupons").update({ show_in_store: !c.show_in_store }).eq("id", c.id),
                            c.show_in_store ? `${c.code} saiu do destaque da loja` : `${c.code} agora aparece em destaque na loja`,
                          )
                        }
                        className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${c.show_in_store ? "bg-tomato-soft text-tomato-deep" : "bg-sand text-muted hover:text-ink"}`}
                      >
                        <Megaphone className="h-3 w-3" /> {c.show_in_store ? "Em destaque na loja" : "Mostrar na loja"}
                      </button>
                    </div>
                    <Toggle
                      checked={c.active}
                      label={`Cupom ${c.code} ativo`}
                      disabled={busy}
                      onChange={(v) => run(() => sb.from("coupons").update({ active: v }).eq("id", c.id), v ? `Cupom ${c.code} ativado` : `Cupom ${c.code} pausado`)}
                    />
                    {c.uses === 0 ? (
                      <button
                        aria-label={`Apagar ${c.code}`}
                        disabled={busy}
                        onClick={() => confirm(`Apagar o cupom ${c.code}?`) && run(() => sb.from("coupons").delete().eq("id", c.id), "Cupom apagado")}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : (
                      <span className="w-9 shrink-0" title="Cupom já usado: pause em vez de apagar" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {personal.active + personal.used > 0 && (
            <p className="mt-3 rounded-xl bg-info-soft p-2 text-xs text-info">
              Cupons pessoais (fidelidade, cashback e aniversário): {personal.active} valendo e {personal.used} já usados. Eles aparecem na ficha de cada cliente, em Clientes.
            </p>
          )}
          {coupons.some((c) => c.uses > 0) && <p className="mt-3 text-[11px] text-muted">Cupons que já foram usados não podem ser apagados, só pausados, para manter o histórico dos pedidos.</p>}
        </Panel>

        <Panel title="Novo cupom">
          <form onSubmit={create} className="space-y-3">
            <Field label="Código" hint="O cliente digita exatamente isto. Maiúsculas e minúsculas tanto faz.">
              <input className="field font-mono uppercase" value={f.code} onChange={set("code")} maxLength={30} placeholder="BEMVINDO" required />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Tipo">
                <select className="field" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Coupon["discount_type"], value: "" })}>
                  <option value="percentual">% de desconto</option>
                  <option value="valor">Valor fixo (R$)</option>
                </select>
              </Field>
              <Field label={f.type === "percentual" ? "Desconto (%)" : "Desconto (R$)"}>
                {f.type === "percentual" ? (
                  <input className="field" inputMode="decimal" value={f.value} onChange={set("value")} placeholder="10" required />
                ) : (
                  <MoneyInput value={f.value} onChange={(v) => setF({ ...f, value: v })} required />
                )}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Pedido mínimo (R$)">
                <MoneyInput value={f.min} onChange={(v) => setF({ ...f, min: v })} placeholder="opcional" />
              </Field>
              <Field label="Limite de usos">
                <input className="field" inputMode="numeric" value={f.maxUses} onChange={set("maxUses")} placeholder="sem limite" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Começa em">
                <input type="date" className="field" value={f.start} onChange={set("start")} />
              </Field>
              <Field label="Termina em">
                <input type="date" className="field" value={f.end} onChange={set("end")} />
              </Field>
            </div>
            <label className="flex items-start gap-2 rounded-2xl bg-sand/60 p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={f.first} onChange={(e) => setF({ ...f, first: e.target.checked })} />
              <span>
                <span className="font-semibold">Só na primeira compra</span>
                <span className="block text-xs text-muted">Vale uma vez por cliente, para quem nunca pediu (conferido pelo telefone).</span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-2xl bg-sand/60 p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={f.show} onChange={(e) => setF({ ...f, show: e.target.checked })} />
              <span>
                <span className="font-semibold">Mostrar em destaque na loja</span>
                <span className="block text-xs text-muted">Aparece no topo do cardápio e o cliente aplica com um toque. Deixe desmarcado para cupons que você manda só para alguns clientes.</span>
              </span>
            </label>
            {f.show && (
              <Field label="Chamada do destaque (opcional)">
                <input className="field" value={f.description} onChange={set("description")} maxLength={120} placeholder="Ex.: Na sua primeira compra" />
              </Field>
            )}
            <button className="btn w-full" disabled={busy}>
              {busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} Criar cupom
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}
