"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, RefreshCw, Send, Zap } from "lucide-react";
import { toast } from "sonner";
import { Field, PageHeader, Panel, Spinner, Toggle } from "@/components/ui";
import { dbError } from "@/lib/db-error";
import { browserClient } from "@/lib/supabase/client";
import { sendTestWebhook } from "./actions";

export type WebhookConfig = {
  pizzeria_id: string;
  url: string | null;
  secret: string;
  site_url: string | null;
  active: boolean;
  notify_created: boolean;
  notify_status: boolean;
};

const EXAMPLES: [string, string][] = [
  ["pedido.criado", "Olá, {{cliente.nome}}! Recebemos seu pedido #{{pedido.numero}} 🍕 Acompanhe aqui: {{pedido.link_acompanhamento}}"],
  ["confirmado", "Seu pedido #{{pedido.numero}} foi confirmado e já vai para a cozinha."],
  ["preparo", "Seu pedido #{{pedido.numero}} está no forno! 🔥"],
  ["saiu", "Seu pedido #{{pedido.numero}} saiu para entrega 🛵"],
  ["pronto (retirada)", "Seu pedido #{{pedido.numero}} está pronto para retirada."],
  ["entregue", "Pedido entregue! Obrigado por pedir na {{pizzaria.nome}} ❤️"],
  ["cancelado", "Seu pedido #{{pedido.numero}} foi cancelado. Qualquer dúvida, fale com a gente."],
];

export function WebhookForm({ pizzeriaId, config, missingTable }: { pizzeriaId: string; config: WebhookConfig | null; missingTable: boolean }) {
  const router = useRouter();
  const sb = browserClient();
  const [f, setF] = useState({
    url: config?.url ?? "",
    active: config?.active ?? false,
    notify_created: config?.notify_created ?? true,
    notify_status: config?.notify_status ?? true,
  });
  const [busy, setBusy] = useState<"salvando" | "testando" | null>(null);

  const save = async () => {
    const url = f.url.trim();
    if (url && !/^https?:\/\/.+/.test(url)) return toast.error("O endereço precisa começar com https://");
    if (f.active && !url) return toast.error("Informe o endereço do webhook para ligar os avisos.");
    setBusy("salvando");
    const { error } = await sb.from("pizzeria_webhooks").upsert({
      pizzeria_id: pizzeriaId,
      url: url || null,
      active: f.active,
      notify_created: f.notify_created,
      notify_status: f.notify_status,
      site_url: window.location.origin,
      updated_at: new Date().toISOString(),
    });
    setBusy(null);
    if (error) return toast.error(dbError(error));
    toast.success("Automação salva");
    router.refresh();
  };

  const test = async () => {
    setBusy("testando");
    const r = await sendTestWebhook(pizzeriaId);
    setBusy(null);
    if (r.ok) toast.success(r.message);
    else toast.error(r.message);
  };

  const newSecret = async () => {
    if (!confirm("Gerar um novo segredo? O fluxo no n8n vai precisar do valor novo.")) return;
    const { error } = await sb
      .from("pizzeria_webhooks")
      .update({ secret: crypto.randomUUID().replaceAll("-", ""), updated_at: new Date().toISOString() })
      .eq("pizzeria_id", pizzeriaId);
    if (error) return toast.error(dbError(error));
    toast.success("Segredo novo gerado");
    router.refresh();
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado`);
    } catch {
      toast.message(text);
    }
  };

  if (missingTable) {
    return (
      <>
        <PageHeader title="WhatsApp e automações" />
        <Panel>
          <p className="text-sm">
            Falta rodar no Supabase o SQL <code className="rounded bg-sand px-1">supabase/migrations/20261023110000_avisos_n8n.sql</code>. Depois disso, esta página libera a configuração.
          </p>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader title="WhatsApp e automações" subtitle="Envie os pedidos para o n8n e mande mensagens automáticas no WhatsApp do cliente." />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Panel title="Conexão com o n8n">
            <div className="space-y-4">
              <Field label="Endereço do webhook (Production URL do nó Webhook no n8n)">
                <input className="field font-mono text-xs" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://seu-n8n.com/webhook/pede-ai" />
              </Field>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <span className="block font-semibold">Avisos ligados</span>
                  <span className="text-xs text-muted">Desligado, nada é enviado.</span>
                </span>
                <Toggle checked={f.active} label="Avisos ligados" onChange={(v) => setF({ ...f, active: v })} />
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold">Avisar quando um pedido for criado</span>
                <Toggle checked={f.notify_created} label="Pedido criado" onChange={(v) => setF({ ...f, notify_created: v })} />
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold">Avisar a cada mudança de status</span>
                <Toggle checked={f.notify_status} label="Mudança de status" onChange={(v) => setF({ ...f, notify_status: v })} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn" disabled={busy != null} onClick={save}>
                  {busy === "salvando" ? <Spinner className="h-4 w-4" /> : <Zap className="h-4 w-4" />} Salvar
                </button>
                <button className="btn-ghost" disabled={busy != null || !config?.url} onClick={test}>
                  {busy === "testando" ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />} Enviar teste
                </button>
              </div>
            </div>
          </Panel>

          {config && (
            <Panel title="Segredo da conexão">
              <p className="text-sm text-muted">
                Todo aviso chega com o cabeçalho <code className="rounded bg-sand px-1">X-Pede-Ai-Segredo</code>. No n8n, confira esse valor para aceitar só avisos do seu sistema.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <code className="flex-1 truncate rounded-xl bg-sand px-3 py-2 font-mono text-xs">{config.secret}</code>
                <button className="btn-ghost !py-2 text-sm" onClick={() => copy(config.secret, "Segredo")}>
                  <Copy className="h-4 w-4" /> Copiar
                </button>
                <button className="btn-ghost !py-2 text-sm" onClick={newSecret}>
                  <RefreshCw className="h-4 w-4" /> Gerar outro
                </button>
              </div>
            </Panel>
          )}

          <Panel title="Mensagens sugeridas">
            <p className="mb-3 text-sm text-muted">Use no nó de WhatsApp do n8n. O que está entre chaves vem do aviso.</p>
            <ul className="space-y-2 text-sm">
              {EXAMPLES.map(([k, v]) => (
                <li key={k} className="rounded-2xl bg-sand/60 p-3">
                  <p className="text-xs font-bold text-muted">{k}</p>
                  <p className="mt-0.5">{v}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <Panel title="Como montar no n8n">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              Crie um fluxo com o nó <b>Webhook</b>, método <b>POST</b>. Copie a <b>Production URL</b> e cole aqui ao lado.
            </li>
            <li>
              Adicione um nó <b>IF</b> conferindo se o cabeçalho <code>x-pede-ai-segredo</code> é igual ao segredo desta página.
            </li>
            <li>
              Use um nó <b>Switch</b> pelo campo <code>body.evento</code> e <code>body.pedido.status</code> para escolher a mensagem.
            </li>
            <li>
              Envie pelo seu provedor de WhatsApp (API oficial da Meta, Evolution API, Z-API…) usando o número <code>body.cliente.whatsapp</code>.
            </li>
            <li>Ative o fluxo no n8n, salve aqui e clique em <b>Enviar teste</b>.</li>
          </ol>
          <p className="mt-4 rounded-2xl bg-dende-soft p-3 text-xs text-warning">
            Pedidos do balcão sem telefone também geram aviso, mas com <code>whatsapp</code> vazio: no n8n, pule o envio quando esse campo vier vazio.
          </p>
        </Panel>
      </div>
    </>
  );
}
