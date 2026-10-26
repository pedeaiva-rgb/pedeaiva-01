import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { adminClient } from "../supabase/admin";
import type { Credentials } from "./types";

/** Chave do servidor para cifrar os tokens das lojas (PAYMENTS_SECRET_KEY: um texto longo e aleatório). */
function key() {
  const raw = process.env.PAYMENTS_SECRET_KEY;
  if (!raw || raw.length < 32) throw new Error("PAYMENTS_SECRET_KEY ausente ou curta (mínimo 32 caracteres)");
  return createHash("sha256").update(raw).digest();
}
export const secretsConfigured = () => (process.env.PAYMENTS_SECRET_KEY ?? "").length >= 32;

/** AES-256-GCM: "v1.iv.tag.dados" em base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(box: string): string {
  const [v, iv, tag, data] = box.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Credencial em formato desconhecido");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

export async function loadCredentials(pizzeriaId: string): Promise<Credentials | null> {
  const { data } = await adminClient().from("payment_secrets").select("data").eq("pizzeria_id", pizzeriaId).maybeSingle();
  return data ? (JSON.parse(decrypt(data.data as string)) as Credentials) : null;
}

export async function saveCredentials(pizzeriaId: string, c: Credentials) {
  const { error } = await adminClient()
    .from("payment_secrets")
    .upsert({ pizzeria_id: pizzeriaId, data: encrypt(JSON.stringify(c)), updated_at: new Date().toISOString() });
  if (error) throw new Error("Não foi possível guardar a credencial");
}

/** "state" da autorização: assinado, com validade, ligado à loja e à pessoa (impede conectar a conta de outro). */
export function signState(payload: { pz: string; uid: string }, ttlSeconds = 600): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds, n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${body}.${createHmac("sha256", key()).update(body).digest("base64url")}`;
}

export function verifyState(state: string): { pz: string; uid: string } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", key()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { pz: string; uid: string; exp: number };
    return p.exp > Date.now() / 1000 ? { pz: p.pz, uid: p.uid } : null;
  } catch {
    return null;
  }
}
