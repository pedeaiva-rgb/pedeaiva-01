import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/ui";
import { mercadoPago } from "@/lib/payments/mercadopago";
import { secretsConfigured } from "@/lib/payments/secrets";
import { simulatorEnabled } from "@/lib/payments/simulado";
import { createClient } from "@/lib/supabase/server";
import { allowed, getTenant } from "@/lib/tenant";
import type { Pizzeria } from "@/lib/types";
import { NoAccess } from "../no-access";
import { OnlinePayments } from "./online-payments";

export const metadata: Metadata = { title: "Pagamento online" };

/** Financeiro → Pagamento online: a conta (gateway) que recebe o Pix pago pelo site. */
export default async function PagamentosPage({ searchParams }: PageProps<"/painel/pagamentos">) {
  const t = (await getTenant())!;
  if (!allowed(t, "pagamentos")) return <NoAccess />;
  const notice = (await searchParams).pagamento;
  const sb = await createClient();
  const [pz, account] = await Promise.all([
    sb.from("pizzerias").select("online_pix").eq("id", t.pizzeria.id).single(),
    sb.from("payment_accounts").select("provider, account_label, status").eq("pizzeria_id", t.pizzeria.id).maybeSingle(),
  ]);
  return (
    <>
      <PageHeader title="Pagamento online" subtitle="O gateway de pagamento que recebe o Pix pago pelo cliente na loja online." />
      <OnlinePayments
        info={{
          missing: !!account.error,
          isOwner: t.role === "owner",
          enabled: (pz.data as Pick<Pizzeria, "online_pix"> | null)?.online_pix === true,
          account: account.data ? { provider: account.data.provider, label: account.data.account_label, status: account.data.status } : null,
          mpReady: mercadoPago.configured() && secretsConfigured(),
          simulator: simulatorEnabled() && secretsConfigured(),
          notice: typeof notice === "string" ? notice : null,
        }}
      />
      <Panel title="Gateways de pagamento" className="mt-4">
        <ul className="space-y-2 text-sm">
          <li className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <span>
              <b>Mercado Pago</b>
              <span className="block text-xs text-muted">Pix com a conta da própria loja. O dinheiro cai direto na conta do Mercado Pago da loja.</span>
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${mercadoPago.configured() ? "bg-success-soft text-success" : "bg-sand text-muted"}`}>
              {mercadoPago.configured() ? "Disponível" : "Em configuração"}
            </span>
          </li>
          <li className="flex items-center justify-between gap-3 rounded-xl border border-dashed p-3 text-muted">
            <span>
              <b>Outros gateways</b>
              <span className="block text-xs">Tuna, Pagar.me, Asaas e outros, com subconta para cada loja. O sistema já está preparado para eles.</span>
            </span>
            <span className="shrink-0 rounded-full bg-sand px-2 py-0.5 text-[11px] font-bold">Em breve</span>
          </li>
        </ul>
      </Panel>
    </>
  );
}
