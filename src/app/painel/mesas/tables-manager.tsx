"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, QrCode, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Drawer, Spinner, Toggle } from "@/components/ui";
import { dbError } from "@/lib/db-error";
import { browserClient } from "@/lib/supabase/client";
import type { DiningTable } from "./mesas-board";

/** Novo código do QR (o antigo para de funcionar). */
const newQrToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Cadastro das mesas (várias de uma vez), a taxa de serviço padrão e o QR Code das mesas. */
export function TablesManager({
  pizzeriaId,
  tables,
  defaultFee,
  qr,
  onClose,
  onChanged,
}: {
  pizzeriaId: string;
  tables: DiningTable[];
  defaultFee: number;
  qr: { ordering: boolean; autoConfirm: boolean };
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const sb = browserClient();
  const router = useRouter();
  const [ordering, setOrdering] = useState(qr.ordering);
  const [autoConfirm, setAutoConfirm] = useState(qr.autoConfirm);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(tables.length ? "" : "1");
  const [to, setTo] = useState(tables.length ? "" : "10");
  const [area, setArea] = useState("Salão");
  const [seats, setSeats] = useState("4");
  const [fee, setFee] = useState(String(defaultFee));
  const areas = [...new Set(["Salão", ...tables.map((t) => t.area)])];

  const run = async (fn: () => PromiseLike<{ error: unknown }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) toast.error(dbError(error));
    else {
      toast.success(ok);
      router.refresh();
      await onChanged();
    }
    return !error;
  };

  const a = Number(from);
  const b = Number(to || from);
  const taken = new Set(tables.map((t) => t.name));
  const names = a >= 1 && b >= a && b - a < 100 ? Array.from({ length: b - a + 1 }, (_, i) => String(a + i)).filter((nm) => !taken.has(nm)) : [];
  const create = () =>
    run(
      () => sb.from("dining_tables").insert(names.map((name) => ({ pizzeria_id: pizzeriaId, name, area: area.trim() || "Salão", sort: Number(name), seats: Number(seats) || null }))),
      names.length === 1 ? `Mesa ${names[0]} criada` : `${names.length} mesas criadas`,
    ).then((ok) => {
      if (ok) {
        setFrom("");
        setTo("");
      }
    });
  const feeValue = Number(fee.replace(",", "."));

  return (
    <Drawer title="Cadastrar mesas" onClose={onClose} wide>
      <div className="space-y-6 text-sm">
        <section className="space-y-3">
          <h3 className="font-bold">Criar mesas</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-muted">Da mesa</span>
              <input className="field" inputMode="numeric" placeholder="1" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, "").slice(0, 3))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-muted">Até a mesa</span>
              <input className="field" inputMode="numeric" placeholder="10" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, "").slice(0, 3))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-muted">Área</span>
              <input className="field" list="areas" maxLength={30} value={area} onChange={(e) => setArea(e.target.value)} />
              <datalist id="areas">
                {areas.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-muted">Lugares em cada</span>
              <input className="field" inputMode="numeric" placeholder="4" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, "").slice(0, 2))} />
            </label>
          </div>
          <p className="text-xs text-muted">
            Ex.: da 1 até a 10 cria as mesas 1, 2, 3… 10. Use a área para separar Salão, Varanda, Área externa. Mesas de tamanhos diferentes: crie em partes (ex.: 1 a 6 com 4 lugares, 7 a 8 com 6) ou ajuste na lista abaixo.
          </p>
          <button className="btn" disabled={busy || !names.length} onClick={create}>
            {busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {names.length ? `Criar ${names.length} mesa${names.length === 1 ? "" : "s"}` : "Criar mesas"}
          </button>
        </section>

        <section className="space-y-2">
          <h3 className="font-bold">Taxa de serviço padrão</h3>
          <p className="text-xs text-muted">Entra em toda mesa nova. O cliente pode pedir para tirar (o caixa precisa do PIN do gerente). Use 0 para não cobrar.</p>
          <div className="flex items-center gap-2">
            <input aria-label="Taxa de serviço em %" className="field !w-24 text-center" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^\d,.]/g, "").slice(0, 5))} />
            <span className="font-bold">%</span>
            <button
              className="btn-ghost"
              disabled={busy || !(feeValue >= 0 && feeValue <= 30) || feeValue === defaultFee}
              onClick={() => run(() => sb.from("pizzerias").update({ service_fee_pct: feeValue }).eq("id", pizzeriaId), "Taxa de serviço salva")}
            >
              Salvar
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="flex items-center gap-1.5 font-bold">
            <QrCode className="h-4 w-4" /> QR Code das mesas
          </h3>
          <p className="text-xs text-muted">
            Cole um QR em cada mesa. O cliente aponta a câmera do celular, vê o cardápio, chama o garçom e pede a conta, sem baixar aplicativo e sem cadastro.
          </p>
          <div className="flex items-start justify-between gap-3 rounded-2xl border p-3">
            <div>
              <p className="font-bold">Cliente faz o pedido pelo celular</p>
              <p className="text-xs text-muted">
                {ordering ? "Ligado: o cliente escolhe os itens e envia o pedido pelo QR." : "Desligado: o QR só mostra o cardápio; o pedido é feito com o garçom."}
              </p>
            </div>
            <Toggle
              checked={ordering}
              disabled={busy}
              label="Cliente faz o pedido pelo celular"
              onChange={(v) => run(() => sb.from("pizzerias").update({ qr_ordering: v }).eq("id", pizzeriaId), v ? "Pedido pelo QR ligado" : "QR só mostra o cardápio").then((ok) => ok && setOrdering(v))}
            />
          </div>
          {ordering && (
            <div className="flex items-start justify-between gap-3 rounded-2xl border p-3">
              <div>
                <p className="font-bold">Pedido vai direto para a cozinha</p>
                <p className="text-xs text-muted">
                  {autoConfirm
                    ? "Ligado: se a equipe já abriu a mesa, o pedido do cliente sai direto na cozinha. Em mesa livre, a equipe ainda confirma (evita pedido de brincadeira com foto do QR)."
                    : "Desligado: cada pedido do cliente aparece piscando na tela de Mesas e só vai para a cozinha quando alguém da equipe confirma."}
                </p>
              </div>
              <Toggle
                checked={autoConfirm}
                disabled={busy}
                label="Pedido vai direto para a cozinha"
                onChange={(v) => run(() => sb.from("pizzerias").update({ qr_auto_confirm: v }).eq("id", pizzeriaId), v ? "Pedido direto para a cozinha ligado" : "A equipe confirma cada pedido").then((ok) => ok && setAutoConfirm(v))}
              />
            </div>
          )}
          <Link href="/painel/mesas/qr" target="_blank" className="btn-ghost inline-flex">
            <QrCode className="h-4 w-4" /> Imprimir os QR Codes
          </Link>
        </section>

        <section className="space-y-2">
          <h3 className="font-bold">Mesas cadastradas ({tables.length})</h3>
          {tables.length === 0 && <p className="text-xs text-muted">Nenhuma ainda.</p>}
          <ul className="divide-y rounded-2xl border">
            {tables.map((t) => (
              <TableRow key={t.id} table={t} areas={areas} busy={busy} run={run} />
            ))}
          </ul>
        </section>
      </div>
    </Drawer>
  );
}

function TableRow({ table: t, areas, busy, run }: { table: DiningTable; areas: string[]; busy: boolean; run: (fn: () => PromiseLike<{ error: unknown }>, ok: string) => Promise<boolean> }) {
  const sb = browserClient();
  const [name, setName] = useState(t.name);
  const [area, setArea] = useState(t.area);
  const [seats, setSeats] = useState(t.seats ? String(t.seats) : "");
  const dirty = name.trim() !== t.name || area.trim() !== t.area || (Number(seats) || null) !== t.seats;
  const save = () => run(() => sb.from("dining_tables").update({ name: name.trim(), area: area.trim() || "Salão", seats: Number(seats) || null }).eq("id", t.id), "Mesa salva");
  // Mesa que já teve contas não apaga (o banco recusa): aí é desativar.
  const remove = () => confirm(`Apagar a Mesa ${t.name}? Se ela já teve contas, desative em vez de apagar.`) && run(() => sb.from("dining_tables").delete().eq("id", t.id), `Mesa ${t.name} apagada`);

  return (
    <li className="flex flex-wrap items-center gap-2 p-2">
      <input aria-label="Nome da mesa" className="field !w-20 !py-1.5" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
      <select aria-label="Área" className="field !w-auto !py-1.5" value={area} onChange={(e) => setArea(e.target.value)}>
        {areas.map((x) => (
          <option key={x}>{x}</option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-muted">
        <input aria-label={`Lugares da Mesa ${t.name}`} className="field !w-14 !py-1.5 text-center" inputMode="numeric" placeholder="–" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, "").slice(0, 2))} />
        lugares
      </label>
      {dirty && (
        <button className="btn !px-3 !py-1.5 text-xs" disabled={busy || !name.trim()} onClick={save}>
          Salvar
        </button>
      )}
      <span className="ml-auto" />
      <Toggle
        checked={t.active}
        label={t.active ? "Ativa" : "Desativada"}
        disabled={busy}
        onChange={(v) => run(() => sb.from("dining_tables").update({ active: v }).eq("id", t.id), v ? `Mesa ${t.name} ativada` : `Mesa ${t.name} desativada`)}
      />
      <button
        aria-label={`Trocar o QR Code da Mesa ${t.name}`}
        title="Trocar o QR Code (o antigo para de funcionar)"
        className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-sand"
        disabled={busy}
        onClick={() =>
          confirm(`Trocar o QR Code da Mesa ${t.name}? O QR impresso hoje para de funcionar e você precisa imprimir o novo.`) &&
          run(() => sb.from("dining_tables").update({ qr_token: newQrToken() }).eq("id", t.id), `QR Code da Mesa ${t.name} trocado: imprima o novo`)
        }
      >
        <RefreshCw className="h-4 w-4" />
      </button>
      <button aria-label={`Apagar a Mesa ${t.name}`} className="grid h-8 w-8 place-items-center rounded-full text-danger hover:bg-sand" disabled={busy} onClick={remove}>
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}
