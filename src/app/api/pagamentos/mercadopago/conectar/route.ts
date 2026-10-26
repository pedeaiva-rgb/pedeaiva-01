import { NextResponse, type NextRequest } from "next/server";
import { mercadoPago } from "@/lib/payments/mercadopago";
import { secretsConfigured, signState } from "@/lib/payments/secrets";
import { getUser } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant";

/** "Conectar Mercado Pago": manda o dono para autorizar a plataforma na conta dele. */
export async function GET(req: NextRequest) {
  const back = new URL("/painel/configuracoes", req.nextUrl.origin);
  const [user, t] = await Promise.all([getUser(), getTenant()]);
  if (!user || !t) return NextResponse.redirect(new URL("/entrar?next=/painel/configuracoes", req.nextUrl.origin));
  if (t.role !== "owner") {
    back.searchParams.set("pagamento", "so-dono");
    return NextResponse.redirect(back);
  }
  if (!mercadoPago.configured() || !secretsConfigured()) {
    back.searchParams.set("pagamento", "sem-chaves");
    return NextResponse.redirect(back);
  }
  const redirectUri = `${process.env.APP_URL ?? req.nextUrl.origin}/api/pagamentos/mercadopago/retorno`;
  return NextResponse.redirect(mercadoPago.authorizeUrl!(signState({ pz: t.pizzeria.id, uid: user.id }), redirectUri));
}
