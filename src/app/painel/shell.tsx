"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Bike, ChefHat, ExternalLink, LayoutDashboard, LogOut, Menu, Monitor, Pizza, Receipt, Settings, Ticket, Users, X, Zap } from "lucide-react";
import { PavLogo } from "@/components/brand/logo";
import { ROLE_LABEL } from "@/lib/order-labels";
import type { Role } from "@/lib/types";
import { signOut, switchPizzeria } from "./actions";

type Area = "pedidos" | "cozinha" | "entregas" | "pdv" | "cardapio" | "configuracoes" | "cupons" | "equipe" | "automacoes";
const NAV: { href: string; label: string; icon: typeof Receipt; area?: Area }[] = [
  { href: "/painel", label: "Visão geral", icon: LayoutDashboard },
  { href: "/painel/pedidos", label: "Pedidos", icon: Receipt, area: "pedidos" },
  { href: "/painel/cozinha", label: "Cozinha", icon: ChefHat, area: "cozinha" },
  { href: "/painel/entregas", label: "Entregas", icon: Bike, area: "entregas" },
  { href: "/painel/pdv", label: "PDV / Balcão", icon: Monitor, area: "pdv" },
  { href: "/painel/cardapio", label: "Cardápio", icon: Pizza, area: "cardapio" },
  { href: "/painel/cupons", label: "Cupons", icon: Ticket, area: "cupons" },
  { href: "/painel/equipe", label: "Equipe", icon: Users, area: "equipe" },
  { href: "/painel/automacoes", label: "WhatsApp e automações", icon: Zap, area: "automacoes" },
  { href: "/painel/configuracoes", label: "Configurações", icon: Settings, area: "configuracoes" },
];

export function Shell({
  email,
  role,
  pizzeria,
  stores,
  access,
  children,
}: {
  email: string | null;
  role: Role;
  pizzeria: { id: string; name: string; slug: string; accepting: boolean };
  stores: { id: string; name: string }[];
  access: Record<Area, readonly Role[]>;
  children: ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => !n.area || access[n.area].includes(role));

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
        <nav className="flex-1 space-y-1">
          {items.map((it) => {
            const active = it.href === "/painel" ? path === "/painel" : path.startsWith(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-tomato text-paper" : "text-cream/80 hover:bg-graphite"}`}
              >
                <it.icon className="h-4 w-4" /> {it.label}
              </Link>
            );
          })}
        </nav>
        <a href={`/${pizzeria.slug}`} target="_blank" rel="noreferrer" className="mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-dende hover:bg-graphite">
          <ExternalLink className="h-4 w-4" /> Ver minha loja
        </a>
        <div className="border-t border-graphite pt-3 text-xs text-cream/60">
          <p className="truncate">{email}</p>
          <p>{ROLE_LABEL[role]}</p>
          <form action={signOut}>
            <button className="mt-2 flex items-center gap-2 font-bold text-cream hover:text-dende">
              <LogOut className="h-4 w-4" /> Sair
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur md:hidden">
          <button onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Menu className="h-6 w-6" />
          </button>
          <p className="truncate font-brand font-extrabold">{pizzeria.name}</p>
        </header>
        {!pizzeria.accepting && (
          <p className="bg-dende-soft px-4 py-2 text-center text-xs font-bold text-warning">A loja online está pausada: clientes não conseguem pedir pelo site.</p>
        )}
        <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
