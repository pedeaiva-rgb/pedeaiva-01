"use server";

import { z } from "zod";
import { CPF_ERROR, validCpf } from "@/lib/cpf";
import { dbError } from "@/lib/db-error";
import { normalizeBrPhone, PHONE_ERROR } from "@/lib/phone";
import { adminClient } from "@/lib/supabase/admin";
import { createClient, getUser } from "@/lib/supabase/server";

const joinSchema = z.object({
  code: z.string().regex(/^[0-9a-f]{32}$/, "Link de convite inválido"),
  full_name: z.string().trim().min(3, "Informe seu nome completo").max(80),
  cpf: z.string().refine(validCpf, CPF_ERROR),
  phone: z.string().refine((v) => normalizeBrPhone(v) != null, PHONE_ERROR),
  email: z.string().trim().toLowerCase().pipe(z.email("E-mail inválido")).optional(),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres").max(72).optional(),
  // Campo escondido: só robô preenche.
  website: z.string().max(0).optional(),
});
export type JoinInput = z.input<typeof joinSchema>;
export type JoinResult = { ok: true; pizzeria: string } | { ok: false; error: string };

/**
 * Cadastro pelo link de convite. Sem login, cria a conta já confirmada (a equipe não depende do e-mail
 * de confirmação) e entra; com login, só registra o pedido. Quem libera o acesso é o dono, no painel.
 */
export async function requestJoin(input: JoinInput): Promise<JoinResult> {
  const parsed = joinSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const d = parsed.data;
  const sb = await createClient();

  if (!(await getUser())) {
    if (!d.email || !d.password) return { ok: false, error: "Informe e-mail e senha para criar seu acesso." };
    const { data: info } = await sb.rpc("invite_info", { _code: d.code });
    if (!(info as unknown[] | null)?.length) return { ok: false, error: "Este link de convite não vale mais. Peça um link novo para a pizzaria." };
    const { error: createError } = await adminClient().auth.admin.createUser({
      email: d.email,
      password: d.password,
      email_confirm: true,
      user_metadata: { full_name: d.full_name },
    });
    const exists = !!createError && /already|registered|exists/i.test(createError.message);
    if (createError && !exists) return { ok: false, error: "Não foi possível criar sua conta. Tente de novo." };
    const { error: loginError } = await sb.auth.signInWithPassword({ email: d.email, password: d.password });
    if (loginError) {
      return {
        ok: false,
        error: exists ? "Este e-mail já tem conta. Use a senha dessa conta ou recupere em “Esqueci a senha”." : "Conta criada, mas não deu para entrar. Tente pela tela de login.",
      };
    }
  }

  const { data, error } = await sb.rpc("request_join", { _code: d.code, _name: d.full_name, _cpf: d.cpf, _phone: d.phone });
  if (error) return { ok: false, error: dbError(error) };
  return { ok: true, pizzeria: data as string };
}
