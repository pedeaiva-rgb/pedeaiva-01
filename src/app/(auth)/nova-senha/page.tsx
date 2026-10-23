"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AuthCard } from "@/components/auth-card";
import { Field, Spinner } from "@/components/ui";
import { browserClient } from "@/lib/supabase/client";

export default function NewPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    setBusy(true);
    const { error } = await browserClient().auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error("Link expirado. Peça um novo em Esqueci minha senha.");
      return;
    }
    toast.success("Senha atualizada");
    router.replace("/painel");
  };
  return (
    <AuthCard title="Criar nova senha">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Nova senha" hint="Pelo menos 8 caracteres.">
          <input className="field" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="btn w-full" disabled={busy}>
          {busy && <Spinner className="h-4 w-4" />} Salvar senha
        </button>
      </form>
    </AuthCard>
  );
}
