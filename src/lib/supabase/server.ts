import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

/** Cliente com a sessão do usuário (respeita as regras de acesso do banco). */
export async function createClient() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Em componentes de servidor não dá para gravar cookie; o proxy renova a sessão.
        }
      },
    },
  });
}

/** Cliente de visitante (sem sessão) para a vitrine pública. */
export const publicClient = cache(() =>
  createPlainClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }),
);

/** Usuário logado, conferido pela assinatura do token. */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: (claims.email as string | undefined) ?? null };
});
