import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/**
 * Cliente com a chave secreta: ignora as regras de acesso. Use só no servidor,
 * e só para o que o visitante não pode fazer sozinho (criar o pedido depois de recalcular o preço).
 */
export function adminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY não configurada");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
