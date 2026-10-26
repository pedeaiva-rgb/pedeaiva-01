"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { CheckCircle2, Clock, Copy, FlaskConical, QrCode, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui";
import { brl } from "@/lib/money";
import type { PixView } from "@/lib/payments";
import { simulateSitePix, sitePixStatus } from "../actions";

/** Tela do Pix: QR Code, copia e cola, tempo para pagar e a espera pela confirmação (consulta a cada 4 s). */
export function PixPanel({ pix, onPaid, onRetry, onBack }: { pix: PixView; onPaid: (token: string) => void; onRetry: () => void; onBack: () => void }) {
  const [status, setStatus] = useState(pix.status);
  const [img, setImg] = useState<string | null>(pix.qr_image);
  const [now, setNow] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);
  const left = Math.max(0, Math.floor((new Date(pix.expires_at).getTime() - now) / 1000));
  const closed = status === "expirado" || status === "cancelado" || status === "erro" || status === "estornado";

  useEffect(() => {
    if (img || !pix.qr_code) return;
    let alive = true;
    import("qrcode").then((q) => q.toDataURL(pix.qr_code!, { margin: 1, width: 320 })).then((d) => alive && setImg(d));
    return () => {
      alive = false;
    };
  }, [img, pix.qr_code]);

  const apply = (r: { status: string; order_token: string | null } | null) => {
    if (!r) return;
    setStatus(r.status);
    if (r.status === "pago" && r.order_token) onPaid(r.order_token);
  };
  const onPoll = useEffectEvent(apply);
  useEffect(() => {
    if (closed) return;
    const poll = setInterval(() => sitePixStatus(pix.id).then(onPoll).catch(() => {}), 4000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [pix.id, closed]);

  const check = async () => {
    setChecking(true);
    const r = await sitePixStatus(pix.id).catch(() => null);
    setChecking(false);
    apply(r);
    if (r?.status === "pendente") toast.message("Ainda não recebemos o Pix. Se já pagou, aguarde alguns segundos.");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pix.qr_code ?? "");
      toast.success("Código Pix copiado! Cole no app do seu banco.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o código e copie.");
    }
  };

  if (status === "pago") {
    return (
      <div className="card mx-auto mt-6 max-w-md space-y-3 p-8 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
        <p className="text-xl font-extrabold">Pix recebido!</p>
        <p className="flex items-center justify-center gap-2 text-sm text-muted">
          <Spinner className="h-4 w-4" /> Abrindo o acompanhamento do pedido…
        </p>
      </div>
    );
  }

  if (closed || left === 0) {
    return (
      <div className="card mx-auto mt-6 max-w-md space-y-3 p-8 text-center">
        <Clock className="mx-auto h-10 w-10 text-warning" />
        <p className="text-lg font-extrabold">{status === "erro" ? "Não foi possível concluir o Pix" : "O tempo para pagar acabou"}</p>
        <p className="text-sm text-muted">Nenhum valor foi cobrado e o pedido não foi enviado. Você pode gerar um novo Pix.</p>
        <div className="flex flex-col gap-2">
          <button className="btn" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" /> Gerar novo Pix
          </button>
          <button className="btn-ghost" onClick={onBack}>
            Escolher outra forma de pagamento
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card mx-auto mt-6 max-w-md space-y-4 p-6 text-center">
      <p className="flex items-center justify-center gap-2 text-lg font-extrabold">
        <QrCode className="h-5 w-5 text-tomato" /> Pague com Pix
      </p>
      <p className="text-3xl font-extrabold">{brl(pix.amount_cents)}</p>
      <p className="text-xs text-muted">Abra o app do seu banco, escolha Pix e leia o QR Code ou use o copia e cola.</p>
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element -- QR do Pix (imagem gerada na hora)
        <img src={img} alt="QR Code do Pix" className="mx-auto aspect-square w-full max-w-[260px] rounded-xl border" />
      ) : (
        <div className="mx-auto aspect-square w-full max-w-[260px] animate-pulse rounded-xl bg-sand" />
      )}
      <button className="btn w-full !py-3" onClick={copy}>
        <Copy className="h-4 w-4" /> Copiar código Pix (copia e cola)
      </button>
      <p className="flex items-center justify-center gap-1.5 text-sm font-bold">
        <Clock className="h-4 w-4" /> Pague em {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}
      </p>
      <p className="flex items-center justify-center gap-2 rounded-xl bg-info-soft p-3 text-xs text-info">
        <Spinner className="h-3.5 w-3.5" /> Esperando o pagamento. A tela muda sozinha quando o Pix cair.
      </p>
      <button className="btn-ghost w-full" disabled={checking} onClick={check}>
        {checking ? <Spinner className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} Já paguei
      </button>
      {pix.simulated && (
        <button className="btn-ghost w-full border-dashed" onClick={() => simulateSitePix(pix.id).then(apply)}>
          <FlaskConical className="h-4 w-4" /> Simular pagamento (teste)
        </button>
      )}
      <button className="text-xs font-bold text-muted underline" onClick={onBack}>
        Voltar e trocar a forma de pagamento
      </button>
    </div>
  );
}
