"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-sand/60 p-6 text-center text-sm text-muted">{children}</p>;
}

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} aria-label="Carregando" />;
}

/** Painel lateral (no celular ocupa a tela toda). Fecha com Esc. */
export function Drawer({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Fechar" className="absolute inset-0 bg-charcoal/40" onClick={onClose} />
      <div className={`relative flex h-full w-full flex-col bg-background shadow-2xl ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}>
        <header className="flex items-center justify-between border-b bg-surface px-5 py-4">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button aria-label="Fechar" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-sand">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition disabled:opacity-50 ${checked ? "bg-success" : "bg-line"}`}
    >
      <span className={`h-5 w-5 rounded-full bg-paper shadow transition ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}
