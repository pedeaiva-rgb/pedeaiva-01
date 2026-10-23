"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Minus, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Field, PageHeader, Panel, Spinner } from "@/components/ui";
import { dbError } from "@/lib/db-error";
import { ROLE_LABEL } from "@/lib/order-labels";
import { browserClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/types";

export type Member = { user_id: string; role: Role; display_name: string | null; created_at: string; is_me: boolean };

const ROLES: Role[] = ["owner", "manager", "cashier", "kitchen", "driver"];

/** Espelho das regras do banco (o banco é quem decide). */
const PERMS: [string, Role[]][] = [
  ["Ver e acompanhar pedidos", ["owner", "manager", "cashier", "kitchen", "driver"]],
  ["Confirmar e cancelar pedidos", ["owner", "manager", "cashier"]],
  ["Preparo (em preparo / pronto)", ["owner", "manager", "cashier", "kitchen"]],
  ["Saída e entrega", ["owner", "manager", "cashier", "driver"]],
  ["PDV e recebimento", ["owner", "manager", "cashier"]],
  ["Estornar pagamento", ["owner", "manager"]],
  ["Cardápio, cupons e configurações", ["owner", "manager"]],
  ["Equipe", ["owner"]],
];

export function TeamManager({ pizzeriaId, members }: { pizzeriaId: string; members: Member[] }) {
  const router = useRouter();
  const sb = browserClient();
  const [f, setF] = useState({ email: "", name: "", role: "cashier" as Role });
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => PromiseLike<{ error: unknown }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      toast.error(dbError(error));
      return false;
    }
    toast.success(ok);
    router.refresh();
    return true;
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () => sb.rpc("add_member_by_email", { _pz: pizzeriaId, _email: f.email.trim(), _role: f.role, _name: f.name.trim() || null }),
      "Acesso liberado",
    );
    if (ok) setF({ email: "", name: "", role: "cashier" });
  };

  return (
    <>
      <PageHeader title="Equipe" subtitle="Quem acessa o painel desta pizzaria e o que cada um pode fazer." />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Panel title="Pessoas com acesso">
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-tomato-soft font-bold text-tomato-deep">
                  {(m.display_name ?? (m.is_me ? "V" : "?")).slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{m.display_name ?? (m.is_me ? "Você" : "Membro da equipe")}{m.is_me && m.display_name ? " (você)" : ""}</p>
                  <p className="text-xs text-muted">Desde {new Date(m.created_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
                </div>
                {m.is_me ? (
                  <span className="rounded-full bg-sand px-3 py-1 text-xs font-bold">{ROLE_LABEL[m.role]}</span>
                ) : (
                  <>
                    <select
                      aria-label="Função"
                      className="field !w-auto !py-1.5 text-sm"
                      value={m.role}
                      disabled={busy}
                      onChange={(e) =>
                        run(
                          () => sb.from("members").update({ role: e.target.value as Role }).eq("pizzeria_id", pizzeriaId).eq("user_id", m.user_id),
                          "Função atualizada",
                        )
                      }
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      aria-label="Remover acesso"
                      disabled={busy}
                      onClick={() =>
                        confirm(`Remover o acesso de ${m.display_name ?? "esta pessoa"}?`) &&
                        run(() => sb.from("members").delete().eq("pizzeria_id", pizzeriaId).eq("user_id", m.user_id), "Acesso removido")
                      }
                      className="grid h-9 w-9 place-items-center rounded-full text-muted hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Adicionar pessoa">
          <form onSubmit={add} className="space-y-3">
            <p className="text-xs text-muted">A pessoa precisa criar a conta primeiro em “Criar minha loja” (só o cadastro, sem criar pizzaria). Depois você libera o acesso aqui pelo e-mail dela.</p>
            <Field label="E-mail da conta">
              <input className="field" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </Field>
            <Field label="Nome (como aparece aqui)">
              <input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} placeholder="Ex.: Ana do caixa" />
            </Field>
            <Field label="Função">
              <select className="field" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn w-full" disabled={busy || !f.email.trim()}>
              {busy ? <Spinner className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />} Liberar acesso
            </button>
          </form>
        </Panel>
      </div>

      <Panel title="O que cada função pode fazer" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 pr-3 font-bold">Permissão</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-2 py-2 text-center font-bold">
                    {ROLE_LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {PERMS.map(([label, roles]) => (
                <tr key={label}>
                  <td className="py-2 pr-3 font-semibold">{label}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-2 py-2 text-center">
                      {roles.includes(r) ? <Check className="mx-auto h-4 w-4 text-success" /> : <Minus className="mx-auto h-4 w-4 text-line" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
