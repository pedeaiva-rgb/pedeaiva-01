import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { SetupNotice } from "@/components/setup-notice";
import { supabaseConfigured } from "@/lib/supabase/env";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignupPage() {
  if (!supabaseConfigured) return <SetupNotice />;
  return (
    <AuthCard
      title="Crie sua conta"
      subtitle="Depois de confirmar o e-mail, você cria a sua loja."
      footer={
        <>
          Já tem conta?{" "}
          <Link href="/entrar" className="font-bold text-tomato">
            Entrar
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthCard>
  );
}
