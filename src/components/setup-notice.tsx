import Link from "next/link";
import { PavLogo } from "./brand/logo";

/** Mostrado enquanto o arquivo .env.local com os dados do Supabase não existir. */
export function SetupNotice() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="card w-full max-w-lg space-y-4 p-8">
        <PavLogo />
        <h1 className="text-2xl font-extrabold">Falta conectar o banco de dados</h1>
        <p className="text-sm text-muted">
          Crie um projeto no Supabase, rode o arquivo <code className="rounded bg-sand px-1">supabase/migrations</code> e copie{" "}
          <code className="rounded bg-sand px-1">.env.example</code> para <code className="rounded bg-sand px-1">.env.local</code> com as chaves do
          projeto. O passo a passo está no README.
        </p>
        <Link href="/" className="btn-ghost">
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}
