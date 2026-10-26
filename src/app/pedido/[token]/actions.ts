"use server";

import { publicClient } from "@/lib/supabase/server";

/** Avaliação do pedido pelo link de acompanhamento (o banco confere: entregue, até 7 dias, uma vez). */
export async function submitReview(token: string, rating: number, comment: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(token) || !Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: "Escolha de 1 a 5 estrelas." };
  const { error } = await publicClient().rpc("submit_review", { _token: token, _rating: rating, _comment: comment.slice(0, 500) });
  return error ? { ok: false, error: error.message.length < 120 ? error.message : "Não foi possível enviar a avaliação." } : { ok: true };
}
