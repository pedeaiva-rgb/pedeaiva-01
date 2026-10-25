"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Delete, Monitor, UserRound } from "lucide-react";
import { PavLogo } from "@/components/brand/logo";
import { Spinner } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/order-labels";
import { browserClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/types";
import { counterSignIn } from "./actions";

type Staff = { user_id: string; name: string; role: Role };
const KEY = (code: string) => `pav-balcao:${code}`;
const read = (code: string) => {
  try {
    return localStorage.getItem(KEY(code));
  } catch {
    return null;
  }
};
const save = (code: string, v: string | null) => {
  try {
    if (v) localStorage.setItem(KEY(code), v);
    else localStorage.removeItem(KEY(code));
  } catch {
    // Sem armazenamento: o aparelho se registra de novo ao abrir.
  }
};
const noop = () => () => {};

/** Computador do balcão: lista a equipe; a pessoa toca no nome e digita o PIN para entrar. */
export function CounterKiosk({ code }: { code: string }) {
  const router = useRouter();
  const stored = useSyncExternalStore(noop, () => read(code), () => null);
  const [device, setDevice] = useState<string | null | undefined>(undefined);
  const token = device === undefined ? stored : device;
  const [data, setData] = useState<{ pizzeria: string; staff: Staff[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState<Staff | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Primeira vez: registra este computador no link do balcão.
  useEffect(() => {
    if (token) return;
    let alive = true;
    browserClient()
      .rpc("counter_open", { _code: code })
      .then(({ data: r, error: e }) => {
        if (!alive) return;
        const v = (r ?? {}) as { token?: string; error?: string };
        if (v.token) {
          save(code, v.token);
          setDevice(v.token);
        } else setError(e ? "Sem conexão. Tente de novo." : (v.error ?? "Link inválido."));
      });
    return () => {
      alive = false;
    };
  }, [token, code]);

  // Lista de quem pode entrar (atualiza a cada 30 s).
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = () =>
      browserClient()
        .rpc("counter_staff", { _device: token })
        .then(({ data: r }) => {
          if (!alive) return;
          const v = (r ?? {}) as { error?: string; pizzeria: string; staff: Staff[] };
          if (v.error) {
            save(code, null);
            setDevice(null);
            return;
          }
          setData({ pizzeria: v.pizzeria, staff: v.staff });
        });
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [token, code]);

  const press = (d: string) => {
    setPinError(null);
    setPin((p) => (p.length < 4 ? p + d : p));
  };
  useEffect(() => {
    if (pin.length !== 4 || !who || !token) return;
    let alive = true;
    const t = setTimeout(async () => {
      setBusy(true);
      const r = await counterSignIn(code, token, who.user_id, pin);
      if (!alive) return;
      if (r.ok) {
        router.replace("/painel");
        router.refresh();
        return;
      }
      setBusy(false);
      setPin("");
      setPinError(r.error ?? "Não foi possível entrar.");
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [pin, who, token, code, router]);

  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4 py-8">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <PavLogo />
          <span className="flex items-center gap-1.5 rounded-full bg-charcoal px-3 py-1 text-xs font-bold text-cream">
            <Monitor className="h-3.5 w-3.5" /> Balcão{data ? ` · ${data.pizzeria}` : ""}
          </span>
        </div>

        {error ? (
          <div className="card p-8 text-center text-sm font-semibold text-danger">{error}</div>
        ) : !data ? (
          <div className="grid place-items-center py-20">
            <Spinner className="h-7 w-7 text-tomato" />
          </div>
        ) : who ? (
          <div className="card mx-auto max-w-sm space-y-5 p-7 text-center">
            <button className="flex items-center gap-1 text-sm font-bold text-muted" onClick={() => (setWho(null), setPin(""), setPinError(null))}>
              <ArrowLeft className="h-4 w-4" /> Voltar
            </button>
            <div>
              <p className="text-2xl font-extrabold">{who.name}</p>
              <p className="text-sm text-muted">{ROLE_LABEL[who.role]} · digite seu PIN</p>
            </div>
            <div className="flex justify-center gap-3" aria-label="PIN digitado">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={`h-4 w-4 rounded-full ${i < pin.length ? "bg-ink" : "bg-line"}`} />
              ))}
            </div>
            {pinError && <p className="text-sm font-semibold text-danger">{pinError}</p>}
            <div className="grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} disabled={busy} onClick={() => press(d)} className="rounded-2xl bg-sand py-4 font-brand text-2xl font-extrabold active:bg-dende">
                  {d}
                </button>
              ))}
              <span />
              <button disabled={busy} onClick={() => press("0")} className="rounded-2xl bg-sand py-4 font-brand text-2xl font-extrabold active:bg-dende">
                0
              </button>
              <button disabled={busy} aria-label="Apagar" onClick={() => setPin((p) => p.slice(0, -1))} className="grid place-items-center rounded-2xl py-4 text-muted">
                {busy ? <Spinner className="h-6 w-6" /> : <Delete className="h-6 w-6" />}
              </button>
            </div>
          </div>
        ) : (
          <div className="card p-6">
            <h1 className="text-xl font-extrabold">Quem vai usar o balcão?</h1>
            <p className="mb-4 text-sm text-muted">Toque no seu nome e digite o seu PIN.</p>
            {data.staff.length === 0 ? (
              <p className="rounded-2xl bg-sand/60 p-6 text-center text-sm text-muted">
                Ninguém criou o PIN ainda. Cada pessoa cria o seu no painel, em <b>Meu PIN</b> (no menu, embaixo do e-mail).
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {data.staff.map((s) => (
                  <button key={s.user_id} onClick={() => setWho(s)} className="flex flex-col items-center gap-2 rounded-2xl bg-sand/70 p-4 text-center hover:bg-dende-soft">
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-tomato-soft text-lg font-extrabold text-tomato-deep">
                      {s.name.slice(0, 1).toUpperCase() || <UserRound className="h-5 w-5" />}
                    </span>
                    <span className="text-sm font-bold">{s.name}</span>
                    <span className="text-[11px] text-muted">{ROLE_LABEL[s.role]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
