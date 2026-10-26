"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Field, Spinner } from "@/components/ui";
import { PasswordInput } from "@/components/ui/password-input";
import { browserClient } from "@/lib/supabase/client";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    setBusy(true);
    const { data, error } = await browserClient().auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirmar?next=/painel` },
    });
    setBusy(false);
    if (error) {
      toast.error(/registered|already/i.test(error.message) ? "Este e-mail já tem conta. Use Entrar." : "Não foi possível criar a conta.");
      return;
    }
    // Se a confirmação de e-mail estiver desligada no Supabase, a sessão já vem pronta.
    if (data.session) {
      router.replace("/painel");
      router.refresh();
    } else setSent(true);
  };

  if (sent) {
    return <p className="rounded-2xl bg-success-soft p-4 text-sm text-success">Enviamos um link de confirmação para {email}. Abra o e-mail para ativar a conta.</p>;
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="E-mail">
        <input className="field" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Senha" hint="Pelo menos 8 caracteres.">
        <PasswordInput required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <button className="btn w-full" disabled={busy}>
        {busy && <Spinner className="h-4 w-4" />} Criar conta
      </button>
      <p className="text-center text-xs text-muted">
        Ao criar a conta, você concorda com os{" "}
        <Link href="/sobre/termos" target="_blank" className="underline">
          Termos de uso
        </Link>{" "}
        e a{" "}
        <Link href="/sobre/privacidade" target="_blank" className="underline">
          Política de privacidade
        </Link>
        .
      </p>
    </form>
  );
}
