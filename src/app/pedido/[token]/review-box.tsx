"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui";
import { submitReview } from "./actions";

const LABEL = ["", "Muito ruim", "Ruim", "Ok", "Bom", "Excelente"];

/** Avaliação de 1 a 5 estrelas, uma vez por pedido. */
export function ReviewBox({ token, store }: { token: string; store: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = hover || rating;

  const send = async () => {
    if (!rating) return;
    setBusy(true);
    const r = await submitReview(token, rating, comment).catch(() => ({ ok: false, error: "Sem conexão." }));
    setBusy(false);
    if (!r.ok) return void toast.error(r.error ?? "Não foi possível enviar.");
    toast.success("Obrigado pela avaliação!");
    router.refresh();
  };

  return (
    <div className="card mt-4 space-y-3 p-5 text-center">
      <p className="font-bold">Como foi o seu pedido na {store}?</p>
      <div className="flex justify-center gap-1" onPointerLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} estrela${n > 1 ? "s" : ""}: ${LABEL[n]}`}
            aria-pressed={rating === n}
            onPointerEnter={() => setHover(n)}
            onClick={() => setRating(n)}
            className="p-1"
          >
            <Star className={`h-8 w-8 ${n <= shown ? "fill-dende text-dende" : "text-line"}`} />
          </button>
        ))}
      </div>
      <p className="h-4 text-xs font-bold text-muted">{LABEL[shown]}</p>
      {rating > 0 && (
        <>
          <textarea className="field text-sm" rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Quer contar algo para a loja? (opcional)" />
          <button className="btn w-full" disabled={busy} onClick={send}>
            {busy && <Spinner className="h-4 w-4" />} Enviar avaliação
          </button>
        </>
      )}
    </div>
  );
}
