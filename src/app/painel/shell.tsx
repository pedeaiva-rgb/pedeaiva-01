"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Bike, ChefHat, ExternalLink, KeyRound, LayoutDashboard, LogOut, Menu, Monitor, Pizza, Receipt, Settings, Ticket, Users, UtensilsCrossed, Wallet, X, Zap } from "lucide-react";
import { PavLogo } from "@/components/brand/logo";
import { ROLE_LABEL } from "@/lib/order-labels";
import { areaAllowed, type ManagerPerms } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import { signOut, switchCounterUser, switchPizzeria } from "./actions";
import { CounterGuard } from "./counter-guard";

/** Funções que entram pelo balcão com PIN (cozinha tem o link dela; entregador usa o celular). */
const COUNTER_ROLES: Role[] = ["owner", "manager", "cashier", "attendant", "waiter"];

type Area = "pedidos" | "cozinha" | "entregas" | "entregador" | "mesas" | "pdv" | "caixa" | "cardapio" | "configuracoes" | "cupons" | "equipe" | "automacoes";
type NavItem = { href: string; label: string; icon: typeof Receipt; area?: Area };
/** Menu em grupos (sem título: o topo). Cada pessoa vê só os itens da função dela; grupo vazio some. */
const NAV: { title: string | null; items: NavItem[] }[] = [
  { title: null, items: [{ href: "/painel", label: "Visão geral", icon: LayoutDashboard }] },
  {
    title: "Vendas",
    items: [
      { href: "/painel/pedidos", label: "Pedidos", icon: Receipt, area: "pedidos" },
      { href: "/painel/pdv", label: "PDV / Balcão", icon: Monitor, area: "pdv" },
      { href: "/painel/mesas", label: "Mesas", icon: UtensilsCrossed, area: "mesas" },
    ],
  },
  {
    title: "Produção e entrega",
    items: [
      { href: "/painel/cozinha", label: "Cozinha", icon: ChefHat, area: "cozinha" },
      { href: "/painel/entregas", label: "Entregas", icon: Bike, area: "entregas" },
      { href: "/painel/entregador", label: "Minhas entregas", icon: Bike, area: "entregador" },
    ],
  },
  { title: "Financeiro", items: [{ href: "/painel/caixa", label: "Caixa do dia", icon: Wallet, area: "caixa" }] },
  {
    title: "Loja online",
    items: [
      { href: "/painel/cardapio", label: "Cardápio", icon: Pizza, area: "cardapio" },
      { href: "/painel/cupons", label: "Cupons", icon: Ticket, area: "cupons" },
      { href: "/painel/automacoes", label: "WhatsApp e automações", icon: Zap, area: "automacoes" },
    ],
  },
  {
    title: "Administração",
    items: [
      { href: "/painel/equipe", label: "Equipe", icon: Users, area: "equipe" },
      { href: "/painel/configuracoes", label: "Configurações", icon: Settings, area: "configuracoes" },
    ],
  },
];

export function Shell({
  email,
  role,
  pizzeria,
  stores,
  access,
  perms,
  counter,
  children,
}: {
  email: string | null;
  role: Role;
  pizzeria: { id: string; name: string; slug: string; accepting: boolean };
  stores: { id: string; name: string }[];
  access: Record<Area, readonly Role[]>;
  /** O que o dono liberou para o gerente (some do menu o que não foi liberado). */
  perms: ManagerPerms;
  /** Entrou pelo computador do balcão (com PIN): mostra "Trocar de pessoa" e sai sozinho sem uso. */
  counter?: { code: string; idle: number } | null;
  children: ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // Entregador, cozinha, atendente e garçom vão direto para a tela de trabalho: sem a Visão geral (com valores da loja).
  const noOverview = role === "driver" || role === "kitchen" || role === "attendant" || role === "waiter";
  // "Ver minha loja" é para quem atende o cliente ou cuida do cardápio.
  const driver = role === "driver" || role === "kitchen" || role === "waiter";
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((n) => (n.area ? areaAllowed(role, perms, n.area, access) : !noOverview)) })).filter((g) => g.items.length);

  return (
    <div className="min-h-dvh md:flex">
      {open && <button aria-label="Fechar menu" className="fixed inset-0 z-40 bg-charcoal/40 md:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-charcoal p-4 text-cream transition-transform md:sticky md:top-0 md:h-dvh md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="mb-5 flex items-center justify-between">
          <PavLogo tone="dark" compact />
          <button className="md:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        {stores.length > 1 ? (
          <select
            aria-label="Pizzaria"
            className="mb-4 w-full rounded-xl border border-graphite bg-graphite px-3 py-2 text-sm font-bold"
            value={pizzeria.id}
            onChange={(e) => switchPizzeria(e.target.value)}
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="mb-4 truncate px-3 font-brand text-lg font-extrabold">{pizzeria.name}</p>
        )}
        <nav className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1">
          {groups.map((g) => (
            <div key={g.title ?? "topo"} className="space-y-1">
              {g.title && <p className="px-3 pb-0.5 text-[11px] font-bold tracking-wider text-cream/45 uppercase">{g.title}</p>}
              {g.items.map((it) => {
                const active = it.href === "/painel" ? path === "/painel" : path.startsWith(it.href);
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition ${active ? "bg-tomato text-paper" : "text-cream/80 hover:bg-graphite"}`}
                  >
                    <it.icon className="h-4 w-4" /> {it.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        {!driver && (
        <a href={`/${pizzeria.slug}`} target="_blank" rel="noreferrer" className="mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-dende hover:bg-graphite">
          <ExternalLink className="h-4 w-4" /> Ver minha loja
        </a>
        )}
        <div className="border-t border-graphite pt-3 text-xs text-cream/60">
          <p className="truncate">{email}</p>
          <p>{ROLE_LABEL[role]}</p>
          {COUNTER_ROLES.includes(role) && (
            <Link href="/painel/meu-pin" onClick={() => setOpen(false)} className="mt-2 flex items-center gap-2 font-bold text-cream hover:text-dende">
              <KeyRound className="h-4 w-4" /> Meu PIN
            </Link>
          )}
          {counter ? (
            <form action={switchCounterUser}>
              <button className="mt-2 flex items-center gap-2 font-bold text-dende hover:text-cream">
                <Users className="h-4 w-4" /> Trocar de pessoa
              </button>
            </form>
          ) : (
            <form action={signOut}>
              <button className="mt-2 flex items-center gap-2 font-bold text-cream hover:text-dende">
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </form>
          )}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur md:hidden">
          <button onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Menu className="h-6 w-6" />
          </button>
          <p className="truncate font-brand font-extrabold">{pizzeria.name}</p>
        </header>
        {counter && <CounterGuard idleMinutes={counter.idle} name={email} />}
        {!pizzeria.accepting && (
          <p className="bg-dende-soft px-4 py-2 text-center text-xs font-bold text-warning">A loja online está pausada: clientes não conseguem pedir pelo site.</p>
        )}
        <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
