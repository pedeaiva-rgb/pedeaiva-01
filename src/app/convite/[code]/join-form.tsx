"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Field, Spinner } from "@/components/ui";
import { PasswordInput } from "@/components/ui/password-input";
import { PhoneInput } from "@/components/ui/phone-input";
import { maskCpf, validCpf } from "@/lib/cpf";
import { normalizeBrPhone } from "@/lib/phone";
import { browserClient } from "@/lib/supabase/client";
import { requestJoin } from "./actions";

/** Sai da conta e continua no link, para cadastrar outra pessoa. */
export function SignOutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn-ghost w-full"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await browserClient().auth.signOut();
          router.refresh();
        })
      }
    >
      {pending && <Spinner className="h-4 w-4" />} Sair e cadastrar outra pessoa
    </button>
  );
}

export function JoinForm({ code, email }: { code: string; email: string | null }) {
  const router = useRouter();
  const [f, setF] = useState({ full_name: "", email: "", cpf: "", phone: "", password: "", password2: "", website: "" });
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const logged = email != null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validCpf(f.cpf)) return toast.error("CPF inválido. Confira os números.");
    if (!normalizeBrPhone(f.phone)) return toast.error("WhatsApp inválido: informe DDD + número.");
    if (!logged && f.password !== f.password2) return toast.error("As senhas não são iguais.");
    start(async () => {
      const r = await requestJoin({
        code,
        full_name: f.full_name,
        cpf: f.cpf,
        phone: f.phone,
        website: f.website,
        ...(logged ? {} : { email: f.email, password: f.password }),
      });
      if (r.ok) setDone(r.pizzeria);
      else toast.error(r.error);
    });
  };

  const signOut = async () => {
    await browserClient().auth.signOut();
    router.refresh();
  };

  if (done) {
    return (
      <div className="space-y-4 text-sm">
        <p className="flex gap-2 rounded-2xl bg-success-soft p-4 text-success">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>
            Pronto! Seu pedido para entrar na equipe da <b>{done}</b> foi enviado. Assim que o responsável liberar, seu acesso aparece no painel.
          </span>
        </p>
        <Link href="/painel" className="btn w-full">
          Ir para o painel
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {logged && (
        <p className="rounded-2xl bg-sand/70 p-3 text-xs">
          Você está conectado como <b>{email}</b>.{" "}
          <button type="button" onClick={signOut} className="font-bold text-tomato">
            Não é você?
          </button>
        </p>
      )}
      <Field label="Nome completo">
        <input className="field" required minLength={3} maxLength={80} autoComplete="name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
      </Field>
      {!logged && (
        <Field label="E-mail">
          <input className="field" type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="CPF">
          <input
            className="field"
            required
            inputMode="numeric"
            maxLength={14}
            placeholder="000.000.000-00"
            value={f.cpf}
            onChange={(e) => setF({ ...f, cpf: maskCpf(e.target.value) })}
          />
        </Field>
        <Field label="WhatsApp">
          <PhoneInput required value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
        </Field>
      </div>
      {!logged && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Senha" hint="Pelo menos 8 caracteres.">
            <PasswordInput required minLength={8} maxLength={72} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
          <Field label="Repita a senha">
            <PasswordInput required minLength={8} maxLength={72} autoComplete="new-password" value={f.password2} onChange={(e) => setF({ ...f, password2: e.target.value })} />
          </Field>
        </div>
      )}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
        value={f.website}
        onChange={(e) => setF({ ...f, website: e.target.value })}
      />
      <button className="btn w-full" disabled={pending}>
        {pending && <Spinner className="h-4 w-4" />} Pedir acesso
      </button>
      <p className="text-xs text-muted">Seus dados ficam visíveis só para o responsável pela pizzaria.</p>
    </form>
  );
}
