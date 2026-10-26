import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { SetupNotice } from "@/components/setup-notice";
import { supabaseConfigured } from "@/lib/supabase/env";
import { ROLE_LABEL } from "@/lib/order-labels";
import { createClient, getUser } from "@/lib/supabase/server";
import { getMemberships } from "@/lib/tenant";
import { JoinForm, SignOutButton } from "./join-form";

export const metadata: Metadata = { title: "Convite para a equipe", robots: { index: false } };

export default async function ConvitePage({ params }: PageProps<"/convite/[code]">) {
  if (!supabaseConfigured) return <SetupNotice />;
  const { code } = await params;
  const sb = await createClient();
  const [{ data }, user] = await Promise.all([sb.rpc("invite_info", { _code: code }), getUser()]);
  const info = (data as { pizzeria_name: string; pizzeria_slug: string }[] | null)?.[0];

  if (!info) {
    return (
      <AuthCard title="Convite inválido" subtitle="Este link não vale mais ou foi digitado errado. Peça um link novo para a loja.">
        <Link href="/" className="btn-ghost w-full">
          Voltar ao início
        </Link>
      </AuthCard>
    );
  }
  // Quem já é da equipe (por exemplo, o dono testando o próprio link) não tem o que pedir.
  const mine = user ? (await getMemberships()).find((m) => m.pizzeria.slug === info.pizzeria_slug) : undefined;
  if (mine) {
    return (
      <AuthCard
        title="Você já faz parte desta equipe"
        subtitle={`Você está conectado como ${user!.email ?? "sua conta"}, que já é ${ROLE_LABEL[mine.role]} da ${info.pizzeria_name}. Este link é para outra pessoa se cadastrar.`}
      >
        <div className="space-y-3">
          <p className="rounded-2xl bg-sand/70 p-3 text-xs">
            Para testar o cadastro como se fosse um funcionário, abra o link numa <b>janela anônima</b> do navegador (Ctrl+Shift+N) ou em outro celular.
          </p>
          <Link href="/painel" className="btn w-full">
            Ir para o painel
          </Link>
          <SignOutButton />
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title={`Equipe da ${info.pizzeria_name}`}
      subtitle="Preencha seus dados para pedir acesso. O responsável pela loja libera e escolhe sua função."
      footer={
        user ? undefined : (
          <>
            Já tem conta?{" "}
            <Link href={`/entrar?next=/convite/${code}`} className="font-bold text-tomato">
              Entrar
            </Link>
          </>
        )
      }
    >
      <JoinForm code={code} email={user ? (user.email ?? "sua conta") : null} />
    </AuthCard>
  );
}
