import "server-only";
import { z } from "zod";
import { adminClient } from "./supabase/admin";

export const qrTokenSchema = z.string().regex(/^[a-f0-9]{20,64}$/);

/** Acha a mesa pelo código do QR (sem login: o código longo e aleatório é a chave). */
export async function tableByToken(token: string) {
  if (!qrTokenSchema.safeParse(token).success) return null;
  const { data } = await adminClient().from("dining_tables").select("id, name, active, pizzeria_id").eq("qr_token", token).maybeSingle();
  return data as { id: string; name: string; active: boolean; pizzeria_id: string } | null;
}
