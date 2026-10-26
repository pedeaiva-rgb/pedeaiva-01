"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PavLogo } from "@/components/brand/logo";
import { Field, Spinner } from "@/components/ui";
import { STORE_KINDS, STORE_TEMPLATES, type StoreKind } from "@/lib/store-templates";
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
  const [kind, setKind] = useState<StoreKind | null>(null);
  const t = kind ? STORE_TEMPLATES[kind] : null;
  const [pending, start] = useTransition();
  const finalSlug = touched ? slug : toSlug(name);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await createPizzeria({ name, slug: finalSlug, kind: kind ?? "outro" });
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
              {email ? `${email}, ` : ""}sua conta ainda não está ligada a nenhuma loja. Se você faz parte de uma equipe, peça ao dono para te adicionar.
            </p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-bold">Qual é o seu negócio?</p>
            <div className="grid grid-cols-2 gap-2">
              {STORE_KINDS.map((k) => (
                <button key={k} type="button" data-active={kind === k} onClick={() => setKind(k)} className="chip !justify-center !rounded-2xl !py-2.5 text-sm">
                  {STORE_TEMPLATES[k].label}
                </button>
              ))}
            </div>
          </div>
          <Field label="Nome da loja">
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder={t?.example ?? "Ex.: Sabor do Bairro"} />
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
          <button className="btn w-full" disabled={pending || !kind || name.trim().length < 2 || finalSlug.length < 3}>
            {pending && <Spinner className="h-4 w-4" />} Criar loja
          </button>
          {t ? (
            <p className="text-xs text-muted">
              A loja já nasce com as categorias {t.categories.join(", ")}
              {t.sizes.length ? ` e os tamanhos ${t.sizes.map((x) => x.name).join(", ")}` : ""}. Dá para mudar tudo depois.
            </p>
          ) : (
            <p className="text-xs text-muted">Escolha o tipo do negócio para a loja já nascer com categorias de exemplo.</p>
          )}
        </form>
        <form action={signOut} className="mt-4 text-center">
          <button className="text-sm font-bold text-muted hover:text-ink">Sair</button>
        </form>
      </div>
    </main>
  );
}
