import { NextResponse, type NextRequest } from "next/server";
import { mercadoPago } from "@/lib/payments/mercadopago";
import { saveCredentials, verifyState } from "@/lib/payments/secrets";
import { adminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { hasRole } from "@/lib/tenant";

/** Volta da autorização do Mercado Pago: guarda as credenciais (cifradas), ativa a conta da loja e volta para Financeiro → Pagamento online. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const back = new URL("/painel/pagamentos", url.origin);
  const fail = (why: string) => {
    back.searchParams.set("pagamento", why);
    return NextResponse.redirect(back);
  };
  const code = url.searchParams.get("code");
  const state = verifyState(url.searchParams.get("state") ?? "");
  if (!code || !state) return fail("recusado");
  const user = await getUser();
  // A mesma pessoa que pediu a conexão, e ainda dona da loja.
  if (!user || user.id !== state.uid || !(await hasRole(state.pz, ["owner"]))) return fail("recusado");
  try {
    const redirectUri = `${process.env.APP_URL ?? url.origin}/api/pagamentos/mercadopago/retorno`;
    const acc = await mercadoPago.connect!(code, redirectUri);
    await saveCredentials(state.pz, acc.credentials);
    const { error } = await adminClient()
      .from("payment_accounts")
      .upsert({
        pizzeria_id: state.pz,
        provider: "mercadopago",
        mode: "conta_propria",
        status: "ativa",
        external_account_id: acc.external_account_id,
        account_label: acc.account_label.slice(0, 120),
        connected_by: user.id,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    if (error) throw error;
    return fail("conectado");
  } catch (e) {
    console.error("conectar Mercado Pago falhou", (e as Error).message);
    return fail("erro");
  }
}
