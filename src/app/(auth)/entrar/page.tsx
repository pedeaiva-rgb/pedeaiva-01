import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { SetupNotice } from "@/components/setup-notice";
import { supabaseConfigured } from "@/lib/supabase/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/entrar">) {
  if (!supabaseConfigured) return <SetupNotice />;
  const { next } = await searchParams;
  const target = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/painel";
  return (
    <AuthCard
      title="Entrar no painel"
      subtitle="Acesso para donos e equipe das pizzarias."
      footer={
        <>
          Ainda não tem conta?{" "}
          <Link href="/cadastro" className="font-bold text-tomato">
            Criar minha loja
          </Link>
        </>
      }
    >
      <LoginForm next={target} />
    </AuthCard>
  );
}
