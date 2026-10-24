"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Clock, RefreshCw } from "lucide-react";
import { PavLogo } from "@/components/brand/logo";
import { Spinner } from "@/components/ui";
import { signOut } from "./actions";

/** Conta que pediu acesso pelo link de convite e ainda espera o dono liberar. */
export function WaitingApproval({ email, pizzerias }: { email: string | null; pizzerias: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4 py-10">
      <div className="w-full max-w-md">
        <PavLogo />
        <div className="card mt-6 space-y-4 p-7">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-dende-soft text-warning">
            <Clock className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold">Aguardando liberação</h1>
            <p className="mt-1 text-sm text-muted">
              {email ? `${email}, seu` : "Seu"} pedido para entrar na equipe da <b className="text-ink">{pizzerias.join(", ")}</b> foi enviado. Assim que o
              responsável liberar, seu acesso aparece aqui.
            </p>
          </div>
          <button className="btn w-full" disabled={pending} onClick={() => start(() => router.refresh())}>
            {pending ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />} Já liberaram? Atualizar
          </button>
        </div>
        <form action={signOut} className="mt-4 text-center">
          <button className="text-sm font-bold text-muted hover:text-ink">Sair</button>
        </form>
      </div>
    </main>
  );
}
