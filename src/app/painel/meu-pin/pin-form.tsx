"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Field, PageHeader, Panel, Spinner } from "@/components/ui";
import { dbError } from "@/lib/db-error";
import { browserClient } from "@/lib/supabase/client";

const digits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

/** A pessoa cria ou troca o próprio PIN de 4 números (entrar no balcão e, para gerente/dono, autorizar). */
export function PinForm({ pizzeriaId, hasPin, approver }: { pizzeriaId: string; hasPin: boolean; approver: boolean }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) return toast.error("O PIN tem 4 números.");
    if (pin !== again) return toast.error("Os dois PINs não são iguais.");
    setBusy(true);
    const { error } = await browserClient().rpc("set_my_pin", { _pz: pizzeriaId, _pin: pin });
    setBusy(false);
    if (error) return toast.error(dbError(error));
    toast.success(hasPin ? "PIN trocado" : "PIN criado");
    setPin("");
    setAgain("");
    router.refresh();
  };

  return (
    <>
      <PageHeader title="Meu PIN" subtitle="Seu código de 4 números para entrar rápido no computador do balcão." />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Panel title={hasPin ? "Trocar meu PIN" : "Criar meu PIN"}>
          {hasPin && (
            <p className="mb-3 flex items-center gap-1.5 rounded-xl bg-success-soft px-3 py-2 text-sm font-semibold text-success">
              <CheckCircle2 className="h-4 w-4" /> Você já tem um PIN. Pode trocar quando quiser.
            </p>
          )}
          <form onSubmit={save} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="PIN (4 números)">
                <input className="field text-center font-mono text-2xl tracking-[0.5em]" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => setPin(digits(e.target.value))} />
              </Field>
              <Field label="Repita o PIN">
                <input className="field text-center font-mono text-2xl tracking-[0.5em]" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={again} onChange={(e) => setAgain(digits(e.target.value))} />
              </Field>
            </div>
            <button className="btn" disabled={busy || pin.length !== 4 || again.length !== 4}>
              {busy ? <Spinner className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />} {hasPin ? "Trocar PIN" : "Criar PIN"}
            </button>
          </form>
        </Panel>
        <Panel title="Como usar">
          <ul className="list-disc space-y-2 pl-5 text-sm">
            <li>No computador do balcão, toque no seu nome e digite o PIN. Você entra com as permissões da sua função.</li>
            {approver && (
              <li>
                Como gerente/dono, o seu PIN também <b>autoriza cancelamentos e estornos</b> feitos pelo caixa ou atendente.
              </li>
            )}
            <li>Não use datas de aniversário nem sequências como 1234. Não conte seu PIN para ninguém.</li>
            <li>Esqueceu? Crie outro aqui, ou peça ao dono para zerar o seu em Equipe.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}
