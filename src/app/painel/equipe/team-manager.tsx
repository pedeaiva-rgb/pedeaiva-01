"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, Link2, MessageCircle, Minus, RefreshCw, Trash2, UserCheck, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Empty, Field, PageHeader, Panel, Spinner, Toggle } from "@/components/ui";
import { hideCpf } from "@/lib/cpf";
import { dbError } from "@/lib/db-error";
import { ROLE_LABEL } from "@/lib/order-labels";
import { formatBrPhone } from "@/lib/phone";
import { browserClient } from "@/lib/supabase/client";
import { PERM_LABEL, type ManagerPerms } from "@/lib/permissions";
import type { Role } from "@/lib/types";

export type Member = {
  user_id: string;
  role: Role;
  display_name: string | null;
  created_at: string;
  is_me: boolean;
  phone: string | null;
  email: string | null;
  /** Já criou o PIN do balcão (null = não dá para saber ainda). */
  has_pin: boolean | null;
};
export type JoinRequest = {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  cpf: string;
  phone: string;
  status: "pendente" | "aprovado" | "recusado";
  created_at: string;
};
type Invite = { code: string; active: boolean; url: string };

const ROLES: Role[] = ["owner", "manager", "cashier", "attendant", "waiter", "kitchen", "driver"];
/** Funções que o dono escolhe ao aprovar alguém (dono só por promoção, na lista). */
const TEAM_ROLES = ROLES.filter((r) => r !== "owner");
/** O que o gerente (com "cuidar da equipe") pode dar. */
const BELOW_MANAGER: Role[] = ["cashier", "attendant", "waiter", "kitchen", "driver"];

/** Espelho das regras do banco (o banco é quem decide). */
const PERMS: [string, Role[]][] = [
  ["Ver e acompanhar pedidos", ["owner", "manager", "cashier", "attendant", "kitchen", "driver"]],
  ["Confirmar e cancelar pedidos", ["owner", "manager", "cashier", "attendant"]],
  ["Preparo (em preparo / pronto)", ["owner", "manager", "cashier", "kitchen"]],
  ["Saída e entrega", ["owner", "manager", "cashier", "attendant", "driver"]],
  ["Lançar pedidos no PDV", ["owner", "manager", "cashier", "attendant"]],
  ["Mesas: abrir, lançar rodadas e servir", ["owner", "manager", "cashier", "attendant", "waiter"]],
  ["Receber pagamento e fechar a conta da mesa", ["owner", "manager", "cashier"]],
  ["Estornar pagamento", ["owner", "manager"]],
  ["Cardápio, cupons e configurações", ["owner", "manager"]],
  ["Equipe", ["owner"]],
];

const dateBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export function TeamManager({
  pizzeriaId,
  pizzeriaName,
  members,
  pending,
  invite,
  missingMigration,
  viewer,
  managerPerms,
}: {
  pizzeriaId: string;
  pizzeriaName: string;
  members: Member[];
  pending: JoinRequest[];
  invite: Invite | null;
  missingMigration: boolean;
  /** Quem está vendo: o gerente só mexe em quem está abaixo dele. */
  viewer: Role;
  /** Só para o dono (null = falta rodar a migração das permissões). */
  managerPerms: ManagerPerms | null;
}) {
  const router = useRouter();
  const sb = browserClient();
  const owner = viewer === "owner";
  // O que este usuário pode dar/mudar: o dono, qualquer função; o gerente, só abaixo dele.
  const grantable = owner ? ROLES : BELOW_MANAGER;
  const editable = (m: Member) => !m.is_me && (owner || BELOW_MANAGER.includes(m.role));
  const [f, setF] = useState({ email: "", name: "", role: "cashier" as Role });
  const [chosen, setChosen] = useState<Record<string, Role | "">>({});
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

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Link copiado");
    } catch {
      toast.message(text);
    }
  };

  const approve = (r: JoinRequest) => {
    const role = chosen[r.id];
    if (!role) return toast.error("Escolha a função antes de aprovar.");
    run(() => sb.rpc("approve_join", { _request: r.id, _role: role }), `${r.full_name.split(" ")[0]} agora é ${ROLE_LABEL[role]}`);
  };

  const whatsappText = invite
    ? `Olá! Use este link para entrar na equipe da ${pizzeriaName} no Pede aí, vá: ${invite.url}`
    : "";

  return (
    <>
      <PageHeader title="Equipe" subtitle="Quem acessa o painel desta loja e o que cada um pode fazer." />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Panel title={`Pedidos de acesso${pending.length ? ` (${pending.length})` : ""}`}>
            {missingMigration ? (
              <p className="text-sm">
                Falta rodar no Supabase os SQL <code className="rounded bg-sand px-1">20261024000000_funcao_atendente.sql</code> e depois{" "}
                <code className="rounded bg-sand px-1">20261024010000_convites_equipe.sql</code>.
              </p>
            ) : pending.length === 0 ? (
              <Empty>Ninguém aguardando. Envie o link de convite para a pessoa se cadastrar.</Empty>
            ) : (
              <ul className="divide-y">
                {pending.map((r) => (
                  <li key={r.id} className="space-y-3 py-3">
                    <div>
                      <p className="font-bold">{r.full_name}</p>
                      <p className="text-xs text-muted">
                        {r.email} · WhatsApp {formatBrPhone(r.phone)} · CPF {hideCpf(r.cpf)} · pediu em {dateBR(r.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`Função de ${r.full_name}`}
                        className="field !w-auto !py-1.5 text-sm"
                        value={chosen[r.id] ?? ""}
                        onChange={(e) => setChosen({ ...chosen, [r.id]: e.target.value as Role })}
                      >
                        <option value="">Escolha a função…</option>
                        {(owner ? TEAM_ROLES : BELOW_MANAGER).map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
                      <button className="btn !py-2 text-sm" disabled={busy} onClick={() => approve(r)}>
                        <UserCheck className="h-4 w-4" /> Aprovar
                      </button>
                      <button
                        className="btn-ghost !py-2 text-sm"
                        disabled={busy}
                        onClick={() => confirm(`Recusar o pedido de ${r.full_name}?`) && run(() => sb.rpc("reject_join", { _request: r.id }), "Pedido recusado")}
                      >
                        <X className="h-4 w-4" /> Recusar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Pessoas com acesso">
            <ul className="divide-y">
              {members.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-tomato-soft font-bold text-tomato-deep">
                    {(m.display_name ?? (m.is_me ? "V" : "?")).slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">
                      {m.display_name ?? (m.is_me ? "Você" : "Membro da equipe")}
                      {m.is_me && m.display_name ? " (você)" : ""}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {[m.phone && `WhatsApp ${formatBrPhone(m.phone)}`, m.email, `desde ${dateBR(m.created_at)}`].filter(Boolean).join(" · ")}
                    </p>
                    {m.has_pin != null && !["kitchen", "driver"].includes(m.role) && (
                      <p className="flex items-center gap-2 text-xs">
                        <span className={m.has_pin ? "font-semibold text-success" : "text-muted"}>{m.has_pin ? "PIN do balcão criado" : "Ainda sem PIN do balcão"}</span>
                        {m.has_pin && editable(m) && (
                          <button
                            className="font-bold text-muted hover:text-danger"
                            disabled={busy}
                            onClick={() =>
                              confirm(`Zerar o PIN de ${m.display_name ?? "esta pessoa"}? Ela vai precisar criar outro em "Meu PIN".`) &&
                              run(() => sb.rpc("clear_member_pin", { _pz: pizzeriaId, _user: m.user_id }), "PIN zerado")
                            }
                          >
                            Zerar PIN
                          </button>
                        )}
                      </p>
                    )}
                  </div>
                  {!editable(m) ? (
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
                        {grantable.map((r) => (
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
        </div>

        <div className="space-y-4">
          <Panel title="Link de convite">
            {invite ? (
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  Envie este link para quem vai trabalhar com você. A pessoa preenche nome, e-mail, CPF, WhatsApp e senha, e o pedido aparece aqui para você aprovar.
                </p>
                <p className="rounded-xl bg-success-soft px-3 py-2 text-xs font-semibold text-success">
                  O link é fixo: não expira e serve para quantas pessoas você quiser.
                </p>
                <code className={`block break-all rounded-xl bg-sand px-3 py-2 font-mono text-xs ${invite.active ? "" : "opacity-50 line-through"}`}>{invite.url}</code>
                <div className="flex flex-wrap gap-2">
                  <button className="btn !py-2 text-sm" disabled={!invite.active} onClick={() => copy(invite.url)}>
                    <Copy className="h-4 w-4" /> Copiar
                  </button>
                  <a
                    className={`btn-ghost !py-2 text-sm ${invite.active ? "" : "pointer-events-none opacity-50"}`}
                    href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircle className="h-4 w-4" /> Enviar no WhatsApp
                  </a>
                </div>
                <div className="flex items-center justify-between gap-3 border-t pt-3 text-sm">
                  <span>
                    <span className="block font-semibold">Link ativo</span>
                    <span className="text-xs text-muted">Desligado, ninguém novo consegue se cadastrar.</span>
                  </span>
                  <Toggle
                    checked={invite.active}
                    label="Link ativo"
                    disabled={busy}
                    onChange={(v) => run(() => sb.rpc("set_team_invite_active", { _pz: pizzeriaId, _active: v }), v ? "Link ligado" : "Link desligado")}
                  />
                </div>
                <button
                  className="w-full text-center text-xs font-semibold text-muted hover:text-danger"
                  disabled={busy}
                  onClick={() =>
                    confirm("Trocar o link? Use só se o link caiu em mãos erradas: o atual para de funcionar e você precisa mandar o novo para a equipe.") &&
                    run(() => sb.rpc("reset_team_invite", { _pz: pizzeriaId }), "Link trocado")
                  }
                >
                  <RefreshCw className="mr-1 inline h-3 w-3" /> Trocar link (só se ele vazou)
                </button>
              </div>
            ) : (
              <p className="flex gap-2 text-sm text-muted">
                <Link2 className="h-4 w-4 shrink-0" /> O link aparece aqui depois que os SQL de convite forem rodados no Supabase.
              </p>
            )}
          </Panel>

          <Panel title="Já tem conta no sistema?">
            <form onSubmit={add} className="space-y-3">
              <p className="text-xs text-muted">Se a pessoa já tem conta (por exemplo, dona de outra loja), libere direto pelo e-mail dela.</p>
              <Field label="E-mail da conta">
                <input className="field" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
              </Field>
              <Field label="Nome (como aparece aqui)">
                <input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} placeholder="Ex.: Ana do caixa" />
              </Field>
              <Field label="Função">
                <select className="field" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
                  {grantable.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </Field>
              <button className="btn-ghost w-full" disabled={busy || !f.email.trim()}>
                {busy ? <Spinner className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />} Liberar acesso
              </button>
            </form>
          </Panel>
        </div>
      </div>

      {owner && <ManagerPermsPanel pizzeriaId={pizzeriaId} perms={managerPerms} onChanged={() => router.refresh()} />}

      <Panel title="O que cada função pode fazer" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
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

/** Dono escolhe o que o gerente pode fazer (vale para todos os gerentes da loja). */
function ManagerPermsPanel({ pizzeriaId, perms, onChanged }: { pizzeriaId: string; perms: ManagerPerms | null; onChanged: () => void }) {
  const [busy, setBusy] = useState<keyof ManagerPerms | null>(null);
  if (!perms) {
    return (
      <Panel title="O que o gerente pode fazer" className="mt-4">
        <p className="text-sm">
          Falta rodar no Supabase o SQL <code className="rounded bg-sand px-1">20261025060000_permissoes_gerente.sql</code>.
        </p>
      </Panel>
    );
  }
  const set = async (k: keyof ManagerPerms, v: boolean) => {
    setBusy(k);
    const { error } = await browserClient().rpc("set_manager_perms", { _pz: pizzeriaId, _perms: { [k]: v } });
    setBusy(null);
    if (error) return toast.error(dbError(error));
    toast.success(`${PERM_LABEL[k].title}: ${v ? "liberado" : "bloqueado"} para o gerente`);
    onChanged();
  };
  return (
    <Panel title="O que o gerente pode fazer" className="mt-4">
      <p className="mb-3 text-xs text-muted">Vale para todos os gerentes desta loja. O gerente sempre cuida dos pedidos, PDV, cozinha, entregas e caixa.</p>
      <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {(Object.keys(PERM_LABEL) as (keyof ManagerPerms)[]).map((k) => (
          <li key={k} className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="block font-semibold">{PERM_LABEL[k].title}</span>
              <span className="text-xs text-muted">{PERM_LABEL[k].hint}</span>
            </span>
            <Toggle checked={perms[k]} label={PERM_LABEL[k].title} disabled={busy != null} onChange={(v) => set(k, v)} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
