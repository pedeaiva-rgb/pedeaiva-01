"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Empty, Field, PageHeader, Panel, Spinner, Toggle } from "@/components/ui";
import { MoneyInput } from "@/components/ui/money-input";
import { maskPhone, PhoneInput } from "@/components/ui/phone-input";
import { dbError } from "@/lib/db-error";
import { parseHours, WEEKDAYS, type OpeningHours } from "@/lib/hours";
import { brl, centsToInput, parseMoney } from "@/lib/money";
import { browserClient } from "@/lib/supabase/client";
import type { DeliveryZone, Pizzeria } from "@/lib/types";

export function SettingsForm({ pizzeria: pz, zones }: { pizzeria: Pizzeria; zones: DeliveryZone[] }) {
  const router = useRouter();
  const sb = browserClient();
  const [f, setF] = useState({
    name: pz.name,
    description: pz.description,
    phone: maskPhone(pz.phone ?? ""),
    address: pz.address ?? "",
    accepting_orders: pz.accepting_orders,
    allow_delivery: pz.allow_delivery,
    allow_pickup: pz.allow_pickup,
    min_order: centsToInput(pz.min_order_cents),
    prep_minutes: String(pz.prep_minutes),
    half_pricing: pz.half_pricing,
    delivery_mode: pz.delivery_mode,
    delivery_fee: centsToInput(pz.delivery_fee_cents),
    eta_min: String(pz.delivery_eta_min),
    eta_max: String(pz.delivery_eta_max),
  });
  const [hours, setHours] = useState<OpeningHours>(() => parseHours(pz.opening_hours));
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    if (f.name.trim().length < 2) return toast.error("Informe o nome da pizzaria.");
    const min = parseMoney(f.min_order || "0");
    const fee = parseMoney(f.delivery_fee || "0");
    if (min == null) return toast.error("Pedido mínimo inválido.");
    if (fee == null) return toast.error("Taxa de entrega inválida.");
    const prep = Number(f.prep_minutes);
    const etaMin = Number(f.eta_min);
    const etaMax = Number(f.eta_max);
    if (!(Number.isInteger(prep) && prep >= 5 && prep <= 240)) return toast.error("O tempo de preparo vai de 5 a 240 minutos.");
    if (!(Number.isInteger(etaMin) && Number.isInteger(etaMax) && etaMin >= 0 && etaMax >= etaMin && etaMax <= 600)) return toast.error("Confira o prazo de entrega (mínimo e máximo, em minutos).");
    if (!f.allow_delivery && !f.allow_pickup) return toast.error("Deixe pelo menos entrega ou retirada ligada.");
    setBusy(true);
    // Só colunas liberadas para o painel (o endereço da loja não muda).
    const { error } = await sb
      .from("pizzerias")
      .update({
        name: f.name.trim(),
        description: f.description.trim(),
        phone: f.phone.trim() || null,
        address: f.address.trim() || null,
        accepting_orders: f.accepting_orders,
        allow_delivery: f.allow_delivery,
        allow_pickup: f.allow_pickup,
        min_order_cents: min,
        prep_minutes: prep,
        half_pricing: f.half_pricing,
        delivery_mode: f.delivery_mode,
        delivery_fee_cents: fee,
        delivery_eta_min: etaMin,
        delivery_eta_max: etaMax,
        opening_hours: hours,
      })
      .eq("id", pz.id);
    setBusy(false);
    if (error) return toast.error(dbError(error));
    toast.success("Configurações salvas");
    router.refresh();
  };

  const saveButton = (
    <button className="btn !py-2" disabled={busy} onClick={save}>
      {busy && <Spinner className="h-4 w-4" />} Salvar alterações
    </button>
  );

  return (
    <>
      <PageHeader title="Configurações" subtitle={`Endereço da loja: …/${pz.slug} (não muda, para não quebrar links já divulgados)`} actions={saveButton} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Dados da loja">
          <div className="space-y-3">
            <Field label="Nome">
              <input className="field" value={f.name} onChange={set("name")} maxLength={80} />
            </Field>
            <Field label="Descrição (aparece no topo da loja)">
              <textarea className="field" rows={2} value={f.description} onChange={set("description")} maxLength={300} placeholder="Ex.: Pizza de forno a lenha desde 1998" />
            </Field>
            <Field label="Telefone / WhatsApp">
              <PhoneInput value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
            </Field>
            <Field label="Endereço">
              <input className="field" value={f.address} onChange={set("address")} maxLength={200} />
            </Field>
          </div>
        </Panel>

        <Panel title="Funcionamento">
          <div className="space-y-4 text-sm">
            <Row label="Aceitar pedidos pela loja online" hint="Desligue para pausar a loja. O PDV continua funcionando.">
              <Toggle checked={f.accepting_orders} label="Aceitar pedidos" onChange={(v) => setF({ ...f, accepting_orders: v })} />
            </Row>
            <Row label="Fazer entregas">
              <Toggle checked={f.allow_delivery} label="Entrega" onChange={(v) => setF({ ...f, allow_delivery: v })} />
            </Row>
            <Row label="Permitir retirada no balcão">
              <Toggle checked={f.allow_pickup} label="Retirada" onChange={(v) => setF({ ...f, allow_pickup: v })} />
            </Row>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pedido mínimo (R$)" hint="Vale para a loja online.">
                <MoneyInput value={f.min_order} onChange={(v) => setF({ ...f, min_order: v })} />
              </Field>
              <Field label="Tempo de preparo (min)">
                <input className="field" inputMode="numeric" value={f.prep_minutes} onChange={set("prep_minutes")} />
              </Field>
            </div>
            <Field label="Preço da pizza meio a meio">
              <select className="field" value={f.half_pricing} onChange={set("half_pricing")}>
                <option value="mais_caro">Cobra o sabor mais caro</option>
                <option value="media">Cobra a média dos sabores</option>
              </select>
            </Field>
          </div>
        </Panel>

        <Panel title="Horário de funcionamento (loja online)">
          <HoursEditor hours={hours} onChange={setHours} />
        </Panel>

        <Panel title="Entrega">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" data-active={f.delivery_mode === "fixa"} onClick={() => setF({ ...f, delivery_mode: "fixa" })} className="chip !justify-center !rounded-2xl">
                Taxa única
              </button>
              <button type="button" data-active={f.delivery_mode === "bairro"} onClick={() => setF({ ...f, delivery_mode: "bairro" })} className="chip !justify-center !rounded-2xl">
                Taxa por bairro
              </button>
            </div>
            {f.delivery_mode === "fixa" && (
              <Field label="Taxa de entrega (R$)" hint="Use 0 para entrega grátis.">
                <MoneyInput value={f.delivery_fee} onChange={(v) => setF({ ...f, delivery_fee: v })} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prazo mínimo (min)">
                <input className="field" inputMode="numeric" value={f.eta_min} onChange={set("eta_min")} />
              </Field>
              <Field label="Prazo máximo (min)">
                <input className="field" inputMode="numeric" value={f.eta_max} onChange={set("eta_max")} />
              </Field>
            </div>
            {f.delivery_mode === "bairro" && <p className="text-xs text-muted">Com taxa por bairro, o cliente escolhe o bairro na lista abaixo. Bairro fora da lista não recebe entrega.</p>}
          </div>
        </Panel>
      </div>

      {f.delivery_mode === "bairro" && <Zones pizzeriaId={pz.id} zones={zones} />}

      <div className="mt-4 flex justify-end">{saveButton}</div>
    </>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>
        <span className="block font-semibold">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

/** Um turno por dia. Fechar antes de abrir (ex.: 18:00–02:00) atravessa a meia-noite. */
function HoursEditor({ hours, onChange }: { hours: OpeningHours; onChange: (h: OpeningHours) => void }) {
  const setDay = (d: number, v: { open: string; close: string } | null) => {
    const next = { ...hours };
    if (v) next[String(d)] = [v];
    else delete next[String(d)];
    onChange(next);
  };
  const configured = Object.keys(hours).length > 0;
  return (
    <div className="space-y-2 text-sm">
      {!configured && <p className="rounded-xl bg-dende-soft p-3 text-xs text-warning">Sem horário cadastrado, a loja fica aberta sempre que “Aceitar pedidos” estiver ligado.</p>}
      {WEEKDAYS.map((name, d) => {
        const it = hours[String(d)]?.[0];
        return (
          <div key={d} className="grid grid-cols-[80px_auto_1fr_1fr] items-center gap-2">
            <span className="font-semibold">{name}</span>
            <Toggle checked={!!it} label={`Abre ${name}`} onChange={(v) => setDay(d, v ? { open: "18:00", close: "23:00" } : null)} />
            <input type="time" aria-label={`${name} abre`} className="field !py-1.5" disabled={!it} value={it?.open ?? ""} onChange={(e) => it && e.target.value && setDay(d, { ...it, open: e.target.value })} />
            <input type="time" aria-label={`${name} fecha`} className="field !py-1.5" disabled={!it} value={it?.close ?? ""} onChange={(e) => it && e.target.value && setDay(d, { ...it, close: e.target.value })} />
          </div>
        );
      })}
      <p className="text-xs text-muted">Horário de Brasília. Lembre de salvar.</p>
    </div>
  );
}

function Zones({ pizzeriaId, zones }: { pizzeriaId: string; zones: DeliveryZone[] }) {
  const router = useRouter();
  const sb = browserClient();
  const [f, setF] = useState({ name: "", hoods: "", fee: "", min: "", max: "" });
  const [busy, setBusy] = useState(false);
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
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const fee = parseMoney(f.fee || "0");
    if (fee == null) return toast.error("Taxa inválida.");
    const hoods = f.hoods
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!hoods.length) return toast.error("Informe ao menos um bairro.");
    const ok = await run(
      () =>
        sb.from("delivery_zones").insert({
          pizzeria_id: pizzeriaId,
          name: f.name.trim(),
          neighborhoods: hoods,
          fee_cents: fee,
          eta_min: f.min ? Number(f.min) : null,
          eta_max: f.max ? Number(f.max) : null,
        }),
      "Região criada",
    );
    if (ok) setF({ name: "", hoods: "", fee: "", min: "", max: "" });
  };
  return (
    <Panel title="Regiões de entrega" className="mt-4">
      {zones.length === 0 && <Empty>Nenhuma região ainda. Sem regiões, a loja não consegue calcular entrega por bairro.</Empty>}
      <ul className="divide-y">
        {zones.map((z) => (
          <li key={z.id} className="flex items-start gap-3 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-bold">
                {z.name} · {brl(z.fee_cents)}
                {z.eta_min != null && (
                  <span className="font-normal text-muted">
                    {" "}
                    · {z.eta_min}–{z.eta_max ?? z.eta_min} min
                  </span>
                )}
              </p>
              <p className="text-xs text-muted">{z.neighborhoods.join(", ")}</p>
            </div>
            <Toggle checked={z.active} label={`${z.name} ativa`} disabled={busy} onChange={(v) => run(() => sb.from("delivery_zones").update({ active: v }).eq("id", z.id), v ? "Região ativada" : "Região pausada")} />
            <button
              aria-label={`Apagar ${z.name}`}
              disabled={busy}
              onClick={() => confirm(`Apagar a região ${z.name}?`) && run(() => sb.from("delivery_zones").delete().eq("id", z.id), "Região apagada")}
              className="grid h-9 w-9 place-items-center rounded-full text-muted hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-4 grid gap-2 sm:grid-cols-[1fr_2fr]">
        <input className="field" placeholder="Nome da região (ex.: Centro)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} required />
        <input className="field" placeholder="Bairros, separados por vírgula" value={f.hoods} onChange={(e) => setF({ ...f, hoods: e.target.value })} required />
        <div className="grid grid-cols-3 gap-2 sm:col-span-2">
          <MoneyInput aria-label="Taxa da região" placeholder="Taxa R$ 0,00" value={f.fee} onChange={(v) => setF({ ...f, fee: v })} />
          <input className="field" placeholder="Prazo mín." inputMode="numeric" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
          <input className="field" placeholder="Prazo máx." inputMode="numeric" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
        </div>
        <button className="btn sm:col-span-2" disabled={busy || !f.name.trim()}>
          <Plus className="h-4 w-4" /> Adicionar região
        </button>
      </form>
    </Panel>
  );
}
