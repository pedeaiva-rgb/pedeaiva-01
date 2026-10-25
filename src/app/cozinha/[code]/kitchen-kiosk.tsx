"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ChefHat, LogOut } from "lucide-react";
import { PavLogo } from "@/components/brand/logo";
import { Spinner } from "@/components/ui";
import { dbError } from "@/lib/db-error";
import { browserClient } from "@/lib/supabase/client";
import type { OrderStatus } from "@/lib/types";
import { KitchenBoard, type KitchenSource, type Ticket } from "../../painel/cozinha/kitchen-board";

type Opened = { token?: string; needs_pin?: boolean; error?: string; pizzeria?: string; prep_minutes?: number };
const KEY = (code: string) => `pav-cozinha:${code}`;

function readDevice(code: string): string | null {
  try {
    return localStorage.getItem(KEY(code));
  } catch {
    return null;
  }
}
function saveDevice(code: string, token: string | null) {
  try {
    if (token) localStorage.setItem(KEY(code), token);
    else localStorage.removeItem(KEY(code));
  } catch {
    // Sem armazenamento (aba anônima): pede o PIN de novo ao recarregar.
  }
}
const noop = () => () => {};

/** Tela da cozinha aberta pelo link da loja: sem login, com PIN opcional. */
export function KitchenKiosk({ code }: { code: string }) {
  const stored = useSyncExternalStore(noop, () => readDevice(code), () => null);
  const [device, setDevice] = useState<string | null | undefined>(undefined);
  const token = device === undefined ? stored : device;
  const [gate, setGate] = useState<{ needsPin: boolean; error: string | null; pizzeria: string | null }>({ needsPin: false, error: null, pizzeria: null });
  const [info, setInfo] = useState<{ pizzeria: string; prep: number } | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const open = async (p: string | null) => {
    setBusy(true);
    const { data, error } = await browserClient().rpc("kitchen_open", { _code: code, _pin: p });
    setBusy(false);
    const r = (data ?? {}) as Opened;
    if (error || r.error || !r.token) {
      setGate({ needsPin: !!r.needs_pin, error: error ? "Sem conexão. Tente de novo." : (r.error ?? null), pizzeria: r.pizzeria ?? null });
      return;
    }
    saveDevice(code, r.token);
    setDevice(r.token);
    setInfo({ pizzeria: r.pizzeria ?? "", prep: r.prep_minutes ?? 30 });
  };

  // Primeira vez neste aparelho: abre o link (entra direto ou pede o PIN).
  useEffect(() => {
    if (token) return;
    let alive = true;
    browserClient()
      .rpc("kitchen_open", { _code: code, _pin: null })
      .then(({ data, error }) => {
        if (!alive) return;
        const r = (data ?? {}) as Opened;
        if (!error && r.token) {
          saveDevice(code, r.token);
          setDevice(r.token);
          setInfo({ pizzeria: r.pizzeria ?? "", prep: r.prep_minutes ?? 30 });
        } else setGate({ needsPin: !!r.needs_pin, error: error ? "Sem conexão. Tente de novo." : (r.needs_pin ? null : (r.error ?? null)), pizzeria: r.pizzeria ?? null });
      });
    return () => {
      alive = false;
    };
  }, [token, code]);

  const [source] = useState<KitchenSource>(() => ({
    key: code,
    pollMs: 5_000,
    load: async () => {
      const t = readDevice(code);
      if (!t) return null;
      const { data, error } = await browserClient().rpc("kitchen_tickets", { _device: t });
      if (error) return null;
      const r = data as { error?: string; tickets: Ticket[]; waiting: number; pizzeria: string; prep_minutes: number };
      if (r.error) {
        // Link trocado ou PIN mudou: volta para a entrada.
        saveDevice(code, null);
        setDevice(null);
        return null;
      }
      setInfo({ pizzeria: r.pizzeria, prep: r.prep_minutes });
      return { tickets: r.tickets, waiting: r.waiting };
    },
    move: async (id: string, to: OrderStatus) => {
      const { error } = await browserClient().rpc("kitchen_move", { _device: readDevice(code) ?? "", _order: id, _to: to });
      return error ? dbError(error) : null;
    },
  }));

  if (token) {
    return (
      <main className="min-h-dvh bg-paper p-4 md:p-6">
        <KitchenBoard
          source={source}
          prepMinutes={info?.prep ?? 30}
          title={info?.pizzeria ? `Cozinha · ${info.pizzeria}` : "Cozinha"}
          actions={
            <button
              className="btn-ghost !px-3 !py-2 text-sm"
              aria-label="Sair deste aparelho"
              onClick={() => {
                if (!confirm("Desconectar este aparelho da cozinha?")) return;
                saveDevice(code, null);
                setDevice(null);
              }}
            >
              <LogOut className="h-4 w-4" />
            </button>
          }
        />
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <PavLogo />
        <div className="card mt-6 space-y-4 p-7 text-center">
          <ChefHat className="mx-auto h-10 w-10 text-tomato" />
          <h1 className="text-2xl font-extrabold">{gate.pizzeria ? `Cozinha · ${gate.pizzeria}` : "Tela da cozinha"}</h1>
          {gate.needsPin ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (/^\d{4}$/.test(pin)) void open(pin);
              }}
            >
              <p className="text-sm text-muted">Digite o PIN da cozinha (4 números).</p>
              <input
                className="field text-center font-mono text-3xl tracking-[0.6em]"
                inputMode="numeric"
                autoFocus
                maxLength={4}
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
              {gate.error && <p className="text-sm font-semibold text-danger">{gate.error}</p>}
              <button className="btn w-full" disabled={busy || pin.length !== 4}>
                {busy && <Spinner className="h-4 w-4" />} Entrar
              </button>
            </form>
          ) : gate.error ? (
            <p className="text-sm font-semibold text-danger">{gate.error}</p>
          ) : (
            <Spinner className="mx-auto h-6 w-6 text-tomato" />
          )}
        </div>
      </div>
    </main>
  );
}
