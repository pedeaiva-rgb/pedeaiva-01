import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { allowed, getTenant } from "@/lib/tenant";
import { NoAccess } from "../no-access";
import { WebhookForm, type WebhookConfig } from "./webhook-form";

export const metadata: Metadata = { title: "WhatsApp e automações" };

export default async function AutomacoesPage() {
  const t = (await getTenant())!;
  if (!allowed(t, "automacoes")) return <NoAccess />;
  const sb = await createClient();
  const { data, error } = await sb.from("pizzeria_webhooks").select("*").eq("pizzeria_id", t.pizzeria.id).maybeSingle();
  // Sem a migração de avisos rodada, a tabela não existe ainda.
  const missing = !!error && /pizzeria_webhooks|schema cache|does not exist/i.test(error.message);
  return <WebhookForm pizzeriaId={t.pizzeria.id} config={(data ?? null) as WebhookConfig | null} missingTable={missing} />;
}
