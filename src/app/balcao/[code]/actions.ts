"use server";

import { cookies } from "next/headers";
import { COUNTER_COOKIE } from "@/lib/counter";
import { adminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { TENANT_COOKIE } from "@/lib/tenant";

/**
 * Entrar pelo balcão: confere o PIN no banco e abre a sessão da própria pessoa (sem senha de e-mail).
 * A sessão é criada no servidor com a chave secreta; nada sobre a conta vai para o navegador além dos cookies.
 */
export async function counterSignIn(code: string, device: string, userId: string, pin: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^[0-9a-f]{32}$/.test(code) || !/^[0-9a-f]{64}$/.test(device) || !/^[0-9a-f-]{36}$/.test(userId) || !/^\d{4}$/.test(pin)) {
    return { ok: false, error: "Dados inválidos." };
  }
  const admin = adminClient();
  const { data, error } = await admin.rpc("counter_check_pin", { _device: device, _user: userId, _pin: pin });
  const r = (data ?? {}) as { ok?: boolean; error?: string; pizzeria_id?: string; idle_minutes?: number };
  if (error || !r.ok) return { ok: false, error: r.error ?? "Não foi possível conferir o PIN." };

  const { data: u } = await admin.auth.admin.getUserById(userId);
  const email = u.user?.email;
  if (!email) return { ok: false, error: "Esta conta não tem e-mail." };
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !link.properties?.hashed_token) return { ok: false, error: "Não foi possível entrar agora. Tente de novo." };

  const sb = await createClient();
  await sb.auth.signOut();
  const { error: otpError } = await sb.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (otpError) return { ok: false, error: "Não foi possível entrar agora. Tente de novo." };

  const store = await cookies();
  store.set(TENANT_COOKIE, r.pizzeria_id!, { path: "/painel", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  store.set(COUNTER_COOKIE, JSON.stringify({ code, idle: r.idle_minutes ?? 10 }), { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 });
  return { ok: true };
}
