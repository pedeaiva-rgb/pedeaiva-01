import Link from "next/link";
import { Lock } from "lucide-react";

export function NoAccess() {
  return (
    <div className="card mx-auto mt-10 max-w-md p-8 text-center">
      <Lock className="mx-auto h-8 w-8 text-muted" />
      <p className="mt-3 font-bold">Esta área não está liberada para a sua função.</p>
      <p className="mt-1 text-sm text-muted">Peça ao proprietário da pizzaria para ajustar seu acesso.</p>
      <Link href="/painel/pedidos" className="btn-ghost mt-4">
        Ir para Pedidos
      </Link>
    </div>
  );
}
