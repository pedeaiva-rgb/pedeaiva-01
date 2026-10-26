"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2, FlaskConical, Link2, QrCode, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Panel, Spinner, Toggle } from "@/components/ui";
import { connectSimulator, disconnectPayments, setOnlinePix } from "./payment-actions";

export type OnlinePaymentsInfo = {
  /** Faltou rodar o SQL do pagamento online. */
  missing: boolean;
  isOwner: boolean;
  enabled: boolean;
  account: { provider: string; label: string | null; status: string } | null;
  /** Chaves do Mercado Pago configuradas neste servidor. */
  mpReady: boolean;
  simulator: boolean;
  /** Retorno da tela do Mercado Pago (?pagamento=...). */
  notice: string | null;
};

const NOTICE: Record<string, [string, "success" | "error"]> = {
  conectado: ["Conta do Mercado Pago conectada!", "success"],
  recusado: ["A conexão com o Mercado Pago foi cancelada ou não confere. Tente de novo.", "error"],
  erro: ["O Mercado Pago não confirmou a conexão. Tente de novo em instantes.", "error"],
  "sem-chaves": ["O Mercado Pago ainda não foi configurado no servidor do sistema.", "error"],
  "so-dono": ["Só o dono da loja conecta a conta que recebe o dinheiro.", "error"],
};
const PROVIDER_LABEL: Record<string, string> = { mercadopago: "Mercado Pago", simulado: "Simulador de testes" };

/** Pix pelo site: conectar a conta que recebe, ligar/desligar e ver as condições. */
export function OnlinePayments({ info }: { info: OnlinePaymentsInfo }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const n = info.notice ? NOTICE[info.notice] : null;
    if (!n) return;
    if (n[1] === "success") toast.success(n[0]);
    else toast.error(n[0]);
    router.replace("/painel/pagamentos");
  }, [info.notice, router]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    setBusy(true);
    const r = await fn().catch(() => ({ ok: false, error: "Sem conexão." }));
    setBusy(false);
    if (!r.ok) return void toast.error(r.error ?? "Não foi possível salvar.");
    toast.success(ok);
    router.refresh();
  };

  if (info.missing) {
    return (
      <Panel title="Pix pelo site">
        <p className="text-sm">
          Falta rodar no Supabase o SQL <code className="rounded bg-sand px-1">20261026010000_pagamentos_online.sql</code>.
        </p>
      </Panel>
    );
  }

  const acc = info.account?.status === "ativa" ? info.account : null;
  return (
    <Panel title="Pix pelo site">
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          O cliente paga o Pix na hora de fazer o pedido, e o pedido só chega para a loja depois de pago: acaba o pedido falso e o calote. O dinheiro cai direto na
          conta da loja.
        </p>

        {acc ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-success-soft p-3">
            <p className="flex items-center gap-2 font-bold text-success">
              <CheckCircle2 className="h-4 w-4" /> Conectado: {PROVIDER_LABEL[acc.provider] ?? acc.provider}
              {acc.label && acc.label !== PROVIDER_LABEL[acc.provider] ? <span className="font-normal text-ink"> · {acc.label}</span> : null}
            </p>
            {info.isOwner && (
              <button
                className="btn-ghost !py-1.5 text-xs"
                disabled={busy}
                onClick={() => confirm("Desconectar a conta? O Pix pelo site para de funcionar até conectar de novo.") && run(disconnectPayments, "Conta desconectada")}
              >
                <Unlink className="h-3.5 w-3.5" /> Desconectar
              </button>
            )}
          </div>
        ) : info.isOwner ? (
          <div className="space-y-2">
            {info.mpReady ? (
              // Formulário comum (navegação completa): a rota manda para a página de autorização do Mercado Pago.
              <form action="/api/pagamentos/mercadopago/conectar" method="get">
                <button className="btn">
                  <Link2 className="h-4 w-4" /> Conectar minha conta do Mercado Pago
                </button>
              </form>
            ) : (
              <p className="rounded-xl bg-dende-soft p-3 text-xs font-semibold text-warning">
                O Mercado Pago ainda não foi configurado no servidor do sistema (chaves do aplicativo). Assim que estiver, o botão de conectar aparece aqui.
              </p>
            )}
            {info.simulator && (
              <button className="btn-ghost" disabled={busy} onClick={() => run(connectSimulator, "Simulador conectado")}>
                <FlaskConical className="h-4 w-4" /> Usar o simulador (só no computador de teste)
              </button>
            )}
            <p className="text-xs text-muted">Você entra na sua conta do Mercado Pago e autoriza o Pede aí, vá a gerar os Pix da loja. Ninguém vê a sua senha.</p>
          </div>
        ) : (
          <p className="text-xs text-muted">Só o dono da loja conecta a conta que recebe o dinheiro.</p>
        )}

        <div className="flex items-start justify-between gap-3 rounded-2xl border p-3">
          <div>
            <p className="flex items-center gap-1.5 font-bold">
              <QrCode className="h-4 w-4" /> Aceitar Pix pelo site
            </p>
            <p className="text-xs text-muted">
              {info.enabled ? "Ligado: no pedido online aparece a opção “Pix agora”." : "Desligado: o cliente escolhe pagar na entrega ou na retirada, como hoje."}
            </p>
          </div>
          {busy ? (
            <Spinner className="h-5 w-5" />
          ) : (
            <Toggle
              checked={info.enabled}
              disabled={!info.isOwner || (!acc && !info.enabled)}
              label="Aceitar Pix pelo site"
              onChange={(v) => run(() => setOnlinePix(v), v ? "Pix pelo site ligado" : "Pix pelo site desligado")}
            />
          )}
        </div>

        <ul className="space-y-1 text-xs text-muted">
          <li>• Taxa do Mercado Pago no Pix (cerca de 0,99%: confira na sua conta). O Pede aí, vá não cobra nada a mais.</li>
          <li>• Sem cobrança de fim de semana e sem fidelidade: desligue quando quiser.</li>
          <li>• O cliente tem 15 minutos para pagar. Pedido com Pix pago cancelado: o estorno devolve o dinheiro pelo próprio sistema.</li>
        </ul>
      </div>
    </Panel>
  );
}
