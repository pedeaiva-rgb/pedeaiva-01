"use server";

import { createClient } from "@/lib/supabase/server";
import { ACCESS, hasRole } from "@/lib/tenant";

/** Bloqueia endereços internos: o servidor só envia para endereços públicos. */
function publicUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return null;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "[::1]") return null;
    return u;
  } catch {
    return null;
  }
}

/** Envia um aviso de exemplo para o endereço configurado, para conferir o fluxo no n8n. */
export async function sendTestWebhook(pizzeriaId: string): Promise<{ ok: boolean; message: string }> {
  if (!(await hasRole(pizzeriaId, ACCESS.automacoes))) return { ok: false, message: "Você não tem permissão para isso." };
  const sb = await createClient();
  const [{ data: w }, { data: pz }] = await Promise.all([
    sb.from("pizzeria_webhooks").select("url, secret, site_url").eq("pizzeria_id", pizzeriaId).maybeSingle(),
    sb.from("pizzerias").select("slug, name, phone").eq("id", pizzeriaId).single(),
  ]);
  if (!w?.url) return { ok: false, message: "Salve o endereço do webhook antes de testar." };
  const url = publicUrl(w.url);
  if (!url) return { ok: false, message: "O endereço precisa ser público (http/https), não um endereço interno." };

  const body = {
    evento: "teste",
    enviado_em: new Date().toISOString(),
    pizzaria: { slug: pz?.slug, nome: pz?.name, telefone: pz?.phone ?? null },
    pedido: {
      numero: 123,
      status: "confirmado",
      status_anterior: "novo",
      canal: "site",
      tipo: "entrega",
      total_centavos: 6290,
      forma_pagamento: "pix",
      previsao_min: 30,
      previsao_max: 50,
      link_acompanhamento: `${(w.site_url ?? "").replace(/\/$/, "")}/pedido/00000000-0000-0000-0000-000000000000`,
    },
    cliente: { nome: "Cliente de teste", telefone: "71999990001", whatsapp: "5571999990001" },
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pede-Ai-Segredo": w.secret as string },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok
      ? { ok: true, message: `O n8n respondeu ${res.status}: aviso de teste recebido.` }
      : { ok: false, message: `O endereço respondeu ${res.status}. Confira se o fluxo do n8n está ativo e se o método é POST.` };
  } catch {
    return { ok: false, message: "Não foi possível falar com o endereço. Confira a URL e se o n8n está no ar." };
  }
}
