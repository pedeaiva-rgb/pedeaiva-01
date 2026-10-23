"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Field, Spinner } from "@/components/ui";
import { browserClient } from "@/lib/supabase/client";

export default function RecoverPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await browserClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/confirmar?next=/nova-senha` });
    setBusy(false);
    setSent(true); // mesma resposta exista ou não a conta
  };
  return (
    <AuthCard
      title="Recuperar acesso"
      footer={
        <Link href="/entrar" className="font-bold text-tomato">
          Voltar para o login
        </Link>
      }
    >
      {sent ? (
        <p className="rounded-2xl bg-success-soft p-4 text-sm text-success">Se houver uma conta com esse e-mail, você vai receber um link para criar uma nova senha.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="E-mail da conta">
            <input className="field" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <button className="btn w-full" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />} Enviar link
          </button>
        </form>
      )}
    </AuthCard>
  );
}
