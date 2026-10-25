"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Bike, CreditCard, Eye, KeyRound, Landmark, Lock, Printer, QrCode, Unlock, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Empty, Field, PageHeader, Panel, Spinner } from "@/components/ui";
import { MoneyInput } from "@/components/ui/money-input";
import { timeSP } from "@/lib/beep";
import { dbError } from "@/lib/db-error";
import { brl, parseMoney } from "@/lib/money";
import { browserClient } from "@/lib/supabase/client";

export type CashTotals = {
  abertura: number;
  pix: number;
  cartao: number;
  dinheiro_balcao: number;
  dinheiro_entregadores: number;
  estornos: number;
  recebimentos: number;
  total_recebido: number;
  suprimentos: number;
  sangrias: number;
  acerto_entregadores: number;
  esperado_gaveta?: number;
};
export type OpenCash = { id: string; opened_at: string; opening_cents: number; opened_by: string | null; totals: CashTotals; can_see_expected: boolean };
export type Movement = { id: string; kind: "sangria" | "suprimento"; amount_cents: number; reason: string; created_at: string; actor: string | null };
export type ClosedCash = {
  id: string;
  opened_at: string;
  closed_at: string;
  opened_by: string | null;
  closed_by: string | null;
  opening_cents: number;
  counted_cents: number;
  expected_cents: number;
  difference_cents: number;
  summary: CashTotals;
  note: string | null;
};

const dt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const diffLabel = (d: number) => (d === 0 ? "Bateu certinho" : d > 0 ? `Sobrou ${brl(d)}` : `Faltou ${brl(-d)}`);
const diffCls = (d: number) => (d === 0 ? "bg-success-soft text-success" : d > 0 ? "bg-info-soft text-info" : "bg-tomato-soft text-tomato-deep");

/** Caixa do dia: abrir com o troco, sangria/suprimento e fechar contando a gaveta. */
export function CashRegister({
  pizzeriaId,
  pizzeriaName,
  current,
  movements,
  history,
  isBoss,
}: {
  pizzeriaId: string;
  pizzeriaName: string;
  current: OpenCash | null;
  movements: Movement[];
  history: ClosedCash[];
  isBoss: boolean;
}) {
  const router = useRouter();
  const sb = browserClient();
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState("");
  const [mov, setMov] = useState<{ kind: "sangria" | "suprimento"; amount: string; reason: string; pin: string } | null>(null);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [closed, setClosed] = useState<ClosedCash | null>(null);

  const run = async (fn: () => PromiseLike<{ data?: unknown; error: unknown }>, ok: string) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.error) {
      toast.error(dbError(r.error));
      return null;
    }
    toast.success(ok);
    router.refresh();
    return r;
  };

  const open = async () => {
    const cents = parseMoney(opening || "0");
    if (cents == null) return toast.error("Valor inválido.");
    if (await run(() => sb.rpc("open_cash", { _pz: pizzeriaId, _opening_cents: cents }), "Caixa aberto")) setOpening("");
  };

  const saveMovement = async () => {
    if (!mov) return;
    const cents = parseMoney(mov.amount || "0");
    if (!cents) return toast.error("Informe o valor.");
    if (mov.reason.trim().length < 3) return toast.error("Informe o motivo.");
    if (mov.kind === "sangria" && !isBoss) {
      setBusy(true);
      const { error } = await sb.rpc("request_cash_approval", { _pz: pizzeriaId, _pin: mov.pin });
      setBusy(false);
      if (error) return toast.error(dbError(error));
    }
    const r = await run(
      () => sb.rpc("cash_movement", { _pz: pizzeriaId, _kind: mov.kind, _amount_cents: cents, _reason: mov.reason }),
      mov.kind === "sangria" ? "Sangria registrada" : "Suprimento registrado",
    );
    if (r) setMov(null);
  };

  const close = async () => {
    const cents = parseMoney(counted || "");
    if (cents == null || !counted.trim()) return toast.error("Conte a gaveta e informe o valor.");
    if (!confirm(`Fechar o caixa com ${brl(cents)} na gaveta?`)) return;
    const r = await run(() => sb.rpc("close_cash", { _pz: pizzeriaId, _counted_cents: cents, _note: note || null }), "Caixa fechado");
    if (!r || !current) return;
    const t = r.data as CashTotals & { contado: number; diferenca: number; session_id: string };
    setClosed({
      id: t.session_id,
      opened_at: current.opened_at,
      closed_at: new Date().toISOString(),
      opened_by: current.opened_by,
      closed_by: null,
      opening_cents: current.opening_cents,
      counted_cents: t.contado,
      expected_cents: t.esperado_gaveta ?? 0,
      difference_cents: t.diferenca,
      summary: t,
      note: note || null,
    });
    setCounted("");
    setNote("");
  };

  return (
    <>
      <PageHeader title="Caixa do dia" subtitle="Abra o caixa com o troco, registre sangrias e suprimentos e feche contando a gaveta." />

      {closed && <ClosingReceipt c={closed} pizzeriaName={pizzeriaName} onDone={() => setClosed(null)} />}

      {!current ? (
        !closed && (
          <Panel title="Caixa fechado">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Troco inicial na gaveta">
                <MoneyInput value={opening} onChange={setOpening} className="field !w-44" />
              </Field>
              <button className="btn" disabled={busy} onClick={open}>
                {busy ? <Spinner className="h-4 w-4" /> : <Unlock className="h-4 w-4" />} Abrir caixa
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">Conte o dinheiro que fica na gaveta para começar (o troco). Os recebimentos a partir de agora entram neste caixa.</p>
          </Panel>
        )
      ) : (
        <div className="space-y-4">
          <p className="flex flex-wrap items-center gap-2 rounded-2xl bg-success-soft px-4 py-2 text-sm font-semibold text-success">
            <Unlock className="h-4 w-4" /> Caixa aberto desde {dt(current.opened_at)}
            {current.opened_by ? ` por ${current.opened_by}` : ""} · troco inicial {brl(current.opening_cents)}
          </p>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(
              [
                ["Pix", current.totals.pix, QrCode],
                ["Cartão", current.totals.cartao, CreditCard],
                ["Dinheiro no balcão", current.totals.dinheiro_balcao, Wallet],
                ["Dinheiro com entregadores", current.totals.dinheiro_entregadores, Bike],
              ] as const
            ).map(([label, v, Icon]) => (
              <div key={label} className="card p-4">
                <p className="flex items-center gap-1.5 text-xs font-bold text-muted">
                  <Icon className="h-3.5 w-3.5" /> {label}
                </p>
                <p className="font-brand text-2xl font-extrabold">{brl(v)}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">
            Total recebido: <b className="text-ink">{brl(current.totals.total_recebido)}</b> em {current.totals.recebimentos} recebimento(s)
            {current.totals.estornos ? ` · estornos ${brl(current.totals.estornos)}` : ""}. O dinheiro com os entregadores só entra na gaveta no acerto (Entregas → Acerto).
          </p>

          <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
            <Panel title="Gaveta">
              <ul className="space-y-1 text-sm">
                <Line label="Troco inicial" v={current.totals.abertura} />
                <Line label="Dinheiro recebido no balcão" v={current.totals.dinheiro_balcao} />
                <Line label="Acerto com entregadores (dinheiro trazido − pago a eles)" v={current.totals.acerto_entregadores} />
                <Line label="Suprimentos (colocado)" v={current.totals.suprimentos} />
                <Line label="Sangrias (retirado)" v={-current.totals.sangrias} />
              </ul>
              {current.can_see_expected ? (
                <p className="mt-3 flex items-center justify-between rounded-xl bg-sand px-3 py-2 font-bold">
                  <span className="flex items-center gap-1.5">
                    <Eye className="h-4 w-4" /> Esperado na gaveta agora
                  </span>
                  {brl(current.totals.esperado_gaveta ?? 0)}
                </p>
              ) : (
                <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-sand px-3 py-2 text-xs text-muted">
                  <Lock className="h-4 w-4" /> O valor esperado aparece depois que você fechar o caixa (fechamento às cegas).
                </p>
              )}

              <div className="mt-4 border-t pt-3">
                <p className="mb-2 text-sm font-bold">Movimentos da gaveta</p>
                {movements.length === 0 ? (
                  <Empty>Nenhuma sangria ou suprimento.</Empty>
                ) : (
                  <ul className="divide-y text-sm">
                    {movements.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                        <span>
                          <b className={m.kind === "sangria" ? "text-tomato-deep" : "text-success"}>{m.kind === "sangria" ? "Sangria" : "Suprimento"}</b> · {m.reason}
                          <span className="block text-xs text-muted">
                            {timeSP(m.created_at)}
                            {m.actor ? ` · ${m.actor}` : ""}
                          </span>
                        </span>
                        <b>{m.kind === "sangria" ? "−" : "+"} {brl(m.amount_cents)}</b>
                      </li>
                    ))}
                  </ul>
                )}
                {mov ? (
                  <div className="mt-3 space-y-2 rounded-2xl border p-3">
                    <p className="text-sm font-bold">{mov.kind === "sangria" ? "Sangria: tirar dinheiro da gaveta" : "Suprimento: colocar dinheiro na gaveta"}</p>
                    <div className="grid grid-cols-[140px_1fr] gap-2">
                      <MoneyInput value={mov.amount} onChange={(v) => setMov({ ...mov, amount: v })} className="field !py-2" />
                      <input
                        className="field !py-2"
                        placeholder={mov.kind === "sangria" ? "Motivo (ex.: depósito, pagar gás)" : "Motivo (ex.: mais troco)"}
                        maxLength={200}
                        value={mov.reason}
                        onChange={(e) => setMov({ ...mov, reason: e.target.value })}
                      />
                    </div>
                    {mov.kind === "sangria" && !isBoss && (
                      <label className="block">
                        <span className="mb-1 flex items-center gap-1 text-xs font-bold text-muted">
                          <KeyRound className="h-3.5 w-3.5" /> PIN do gerente ou do dono
                        </span>
                        <input
                          className="field !py-2 text-center font-mono text-xl tracking-[0.5em]"
                          type="password"
                          inputMode="numeric"
                          maxLength={4}
                          value={mov.pin}
                          onChange={(e) => setMov({ ...mov, pin: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                        />
                      </label>
                    )}
                    <div className="flex gap-2">
                      <button className="btn-ghost flex-1 !py-2" onClick={() => setMov(null)}>
                        Voltar
                      </button>
                      <button className="btn flex-1 !py-2" disabled={busy || (mov.kind === "sangria" && !isBoss && mov.pin.length !== 4)} onClick={saveMovement}>
                        {busy && <Spinner className="h-4 w-4" />} Registrar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn-ghost !py-2 text-sm" onClick={() => setMov({ kind: "sangria", amount: "", reason: "", pin: "" })}>
                      <ArrowUpCircle className="h-4 w-4" /> Sangria
                    </button>
                    <button className="btn-ghost !py-2 text-sm" onClick={() => setMov({ kind: "suprimento", amount: "", reason: "", pin: "" })}>
                      <ArrowDownCircle className="h-4 w-4" /> Suprimento
                    </button>
                  </div>
                )}
              </div>
            </Panel>

            <Panel title="Fechar o caixa">
              <div className="space-y-3">
                <p className="text-xs text-muted">Conte as notas e moedas da gaveta e digite o total. O sistema compara com o que deveria ter.</p>
                <Field label="Quanto tem na gaveta">
                  <MoneyInput value={counted} onChange={setCounted} />
                </Field>
                <Field label="Observação (opcional)">
                  <input className="field" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: faltou troco de R$ 2" />
                </Field>
                <button className="btn w-full" disabled={busy || !counted.trim()} onClick={close}>
                  {busy ? <Spinner className="h-4 w-4" /> : <Lock className="h-4 w-4" />} Fechar caixa
                </button>
              </div>
            </Panel>
          </div>
        </div>
      )}

      <Panel title="Fechamentos anteriores" className="mt-4">
        {history.length === 0 ? (
          <Empty>Nenhum caixa fechado ainda.</Empty>
        ) : (
          <ul className="divide-y text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <b>
                    {dt(h.opened_at)} → {dt(h.closed_at)}
                  </b>
                  <span className="block text-xs text-muted">
                    {[h.opened_by && `abriu ${h.opened_by}`, h.closed_by && `fechou ${h.closed_by}`].filter(Boolean).join(" · ")} · recebido {brl(h.summary?.total_recebido ?? 0)} · contado{" "}
                    {brl(h.counted_cents)}
                    {h.note ? ` · ${h.note}` : ""}
                  </span>
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${diffCls(h.difference_cents)}`}>{diffLabel(h.difference_cents)}</span>
                <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setClosed(h)}>
                  <Printer className="h-3.5 w-3.5" /> Ver / imprimir
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function Line({ label, v: raw }: { label: string; v: number }) {
  const v = raw || 0; // sem "-R$ 0,00"
  return (
    <li className="flex justify-between gap-3">
      <span>{label}</span>
      <b className={v < 0 ? "text-tomato-deep" : ""}>{v < 0 ? `− ${brl(-v)}` : brl(v)}</b>
    </li>
  );
}

/** Resumo do fechamento (tela e impressão em bobina de 80 mm). */
function ClosingReceipt({ c, pizzeriaName, onDone }: { c: ClosedCash; pizzeriaName: string; onDone: () => void }) {
  const t = c.summary;
  return (
    <Panel title="Resumo do fechamento" className="mb-4">
      <div id="comprovante" className="space-y-1 font-mono text-sm">
        <p className="text-center font-bold">{pizzeriaName}</p>
        <p className="text-center">FECHAMENTO DE CAIXA</p>
        <p>
          {dt(c.opened_at)} → {dt(c.closed_at)}
        </p>
        {c.opened_by && <p>Abriu: {c.opened_by}</p>}
        <hr />
        <Row l="Pix" v={t.pix} />
        <Row l="Cartão" v={t.cartao} />
        <Row l="Dinheiro balcão" v={t.dinheiro_balcao} />
        <Row l="Dinheiro entregadores" v={t.dinheiro_entregadores} />
        <Row l="Estornos" v={-t.estornos} />
        <Row l="TOTAL RECEBIDO" v={t.total_recebido} bold />
        <hr />
        <Row l="Troco inicial" v={t.abertura} />
        <Row l="Suprimentos" v={t.suprimentos} />
        <Row l="Sangrias" v={-t.sangrias} />
        <Row l="Acerto entregadores" v={t.acerto_entregadores} />
        <Row l="Esperado na gaveta" v={c.expected_cents} bold />
        <Row l="Contado" v={c.counted_cents} bold />
        <p className="text-center font-bold">{diffLabel(c.difference_cents)}</p>
        {c.note && <p>Obs.: {c.note}</p>}
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn !py-2 text-sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Imprimir
        </button>
        <button className="btn-ghost !py-2 text-sm" onClick={onDone}>
          <Landmark className="h-4 w-4" /> Fechar resumo
        </button>
      </div>
    </Panel>
  );
}

function Row({ l, v: raw, bold = false }: { l: string; v: number; bold?: boolean }) {
  const v = raw || 0;
  return (
    <p className={`flex justify-between ${bold ? "font-bold" : ""}`}>
      <span>{l}</span>
      <span>{v < 0 ? `-${brl(-v)}` : brl(v)}</span>
    </p>
  );
}
