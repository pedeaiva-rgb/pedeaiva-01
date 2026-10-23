"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PavLogo } from "@/components/brand/logo";
import { Field, Spinner } from "@/components/ui";
import { createPizzeria, signOut } from "./actions";

const toSlug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export function Onboarding({ email }: { email: string | null }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const [pending, start] = useTransition();
  const finalSlug = touched ? slug : toSlug(name);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await createPizzeria({ name, slug: finalSlug });
      if (r && !r.ok) toast.error(r.error);
    });
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4 py-10">
      <div className="w-full max-w-md">
        <PavLogo />
        <form onSubmit={submit} className="card mt-6 space-y-4 p-7">
          <div>
            <h1 className="text-2xl font-extrabold">Vamos criar sua loja</h1>
            <p className="mt-1 text-sm text-muted">
              {email ? `${email}, ` : ""}sua conta ainda não está ligada a nenhuma pizzaria. Se você faz parte de uma equipe, peça ao dono para te adicionar.
            </p>
          </div>
          <Field label="Nome da pizzaria">
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="Ex.: Pizzaria do Bairro" />
          </Field>
          <Field label="Endereço da loja" hint="É o link que você vai divulgar. Não dá para trocar depois.">
            <div className="flex items-center rounded-[0.9rem] border bg-surface pl-3 focus-within:border-tomato">
              <span className="text-sm text-muted">…/</span>
              <input
                className="w-full bg-transparent px-1 py-[0.7rem] text-sm outline-none"
                value={finalSlug}
                onChange={(e) => {
                  setTouched(true);
                  setSlug(toSlug(e.target.value));
                }}
                maxLength={40}
                required
              />
            </div>
          </Field>
          <button className="btn w-full" disabled={pending || name.trim().length < 2 || finalSlug.length < 3}>
            {pending && <Spinner className="h-4 w-4" />} Criar pizzaria
          </button>
          <p className="text-xs text-muted">A loja já nasce com as categorias Pizzas, Bebidas e Sobremesas e os tamanhos Broto, Média, Grande e Família. Dá para mudar tudo.</p>
        </form>
        <form action={signOut} className="mt-4 text-center">
          <button className="text-sm font-bold text-muted hover:text-ink">Sair</button>
        </form>
      </div>
    </main>
  );
}
