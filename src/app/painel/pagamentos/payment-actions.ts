"use server";

import { revalidatePath } from "next/cache";
import { PROVIDERS, getAccount, simulatorEnabled } from "@/lib/payments";
import { secretsConfigured } from "@/lib/payments/secrets";
import { adminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant";

type R = { ok: true } | { ok: false; error: string };

/** Só o dono mexe na conta que recebe o dinheiro da loja. */
async function owner() {
  const [user, t] = await Promise.all([getUser(), getTenant()]);
  return user && t?.role === "owner" ? { user, pz: t.pizzeria.id } : null;
}

export async function setOnlinePix(enabled: boolean): Promise<R> {
  const o = await owner();
  if (!o) return { ok: false, error: "Só o dono da loja muda o pagamento online." };
  if (enabled) {
    const acc = await getAccount(o.pz);
    if (!acc || acc.status !== "ativa" || !PROVIDERS[acc.provider]?.configured() || !secretsConfigured()) {
      return { ok: false, error: "Conecte a conta de pagamento antes de ligar o Pix pelo site." };
    }
  }
  const { error } = await adminClient().from("pizzerias").update({ online_pix: enabled }).eq("id", o.pz);
  if (error) return { ok: false, error: "Não foi possível salvar." };
  revalidatePath("/painel/pagamentos");
  return { ok: true };
}

export async function disconnectPayments(): Promise<R> {
  const o = await owner();
  if (!o) return { ok: false, error: "Só o dono da loja desconecta a conta." };
  const admin = adminClient();
  // Desliga o Pix pelo site, apaga as credenciais e marca a conta como desconectada.
  await admin.from("pizzerias").update({ online_pix: false }).eq("id", o.pz);
  await admin.from("payment_secrets").delete().eq("pizzeria_id", o.pz);
  const { error } = await admin.from("payment_accounts").update({ status: "desconectada", updated_at: new Date().toISOString() }).eq("pizzeria_id", o.pz);
  if (error) return { ok: false, error: "Não foi possível desconectar." };
  revalidatePath("/painel/pagamentos");
  return { ok: true };
}

/** Só no computador de teste: conecta o provedor simulado para testar o Pix sem dinheiro. */
export async function connectSimulator(): Promise<R> {
  const o = await owner();
  if (!o || !simulatorEnabled()) return { ok: false, error: "Simulador indisponível." };
  const { error } = await adminClient().from("payment_accounts").upsert({
    pizzeria_id: o.pz,
    provider: "simulado",
    mode: "conta_propria",
    status: "ativa",
    account_label: "Simulador de testes",
    connected_by: o.user.id,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: "Não foi possível conectar o simulador." };
  revalidatePath("/painel/pagamentos");
  return { ok: true };
}
