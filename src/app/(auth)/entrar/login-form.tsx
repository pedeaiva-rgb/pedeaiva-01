"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Field, Spinner } from "@/components/ui";
import { browserClient } from "@/lib/supabase/client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await browserClient().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      toast.error(/confirm/i.test(error.message) ? "Confirme seu e-mail antes de entrar." : "E-mail ou senha incorretos.");
      return;
    }
    router.replace(next);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="E-mail">
        <input className="field" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Senha">
        <input className="field" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <button className="btn w-full" disabled={busy}>
        {busy && <Spinner className="h-4 w-4" />} Entrar
      </button>
      <Link href="/recuperar" className="block text-center text-xs font-bold text-muted hover:text-ink">
        Esqueci minha senha
      </Link>
    </form>
  );
}
