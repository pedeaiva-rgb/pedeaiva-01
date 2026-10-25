"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { browserClient } from "@/lib/supabase/client";

/** Busca o código de entrega (só a loja consegue ler; o entregador não). */
export async function fetchDeliveryCode(orderId: string): Promise<string | null> {
  const { data } = await browserClient().from("delivery_codes").select("code").eq("order_id", orderId).maybeSingle();
  return (data?.code as string | undefined) ?? null;
}

/** Código de entrega para o atendente passar ao cliente (pedido por telefone, cliente sem WhatsApp). */
export function DeliveryCode({ orderId, compact = false }: { orderId: string; compact?: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchDeliveryCode(orderId).then((c) => alive && setCode(c));
    return () => {
      alive = false;
    };
  }, [orderId]);
  if (!code) return null;
  if (compact) {
    return (
      <p className="flex items-center gap-1 text-xs text-muted">
        <KeyRound className="h-3.5 w-3.5" /> Código de entrega: <b className="font-mono tracking-widest text-ink">{code}</b>
      </p>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-dende-soft p-3">
      <KeyRound className="h-5 w-5 shrink-0 text-warning" />
      <div className="flex-1 text-xs">
        <p className="font-bold text-warning">Código de entrega</p>
        <p className="text-muted">O cliente informa ao entregador. Pedido por telefone: fale este código para ele.</p>
      </div>
      <p className="font-mono text-2xl font-extrabold tracking-[0.3em]">{code}</p>
    </div>
  );
}
