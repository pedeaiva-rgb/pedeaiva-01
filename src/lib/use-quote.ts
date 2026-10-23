"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { Quote, QuoteResult } from "./orders";

type State = { key: string; quote: Quote | null; error: string | null };

/** Pede ao servidor o valor do pedido sempre que algo relevante muda (com pequena espera entre digitações). */
export function useQuote(enabled: boolean, deps: unknown, fetcher: () => Promise<QuoteResult>) {
  const key = JSON.stringify(deps);
  const [state, setState] = useState<State>({ key: "", quote: null, error: null });
  const load = useEffectEvent(async (k: string) => {
    try {
      const r = await fetcher();
      setState(r.ok ? { key: k, quote: r.quote, error: null } : { key: k, quote: null, error: r.error });
    } catch {
      setState({ key: k, quote: null, error: "Sem conexão para calcular o pedido." });
    }
  });

  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => void load(key), 350);
    return () => clearTimeout(t);
  }, [enabled, key]);

  const fresh = enabled && state.key === key;
  const refresh = async () => {
    const r = await fetcher();
    setState(r.ok ? { key, quote: r.quote, error: null } : { key, quote: null, error: r.error });
  };
  return {
    quote: enabled ? state.quote : null,
    error: enabled ? state.error : null,
    loading: enabled && !fresh,
    refresh,
  };
}

/** Chave de idempotência guardada na aba: reenviar após falha de rede não duplica o pedido. */
export function idempotencyKey(scope: string, renew = false) {
  const k = `pav-idem:${scope}`;
  try {
    const existing = sessionStorage.getItem(k);
    if (existing && !renew) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(k, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}
