"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Copy, Monitor, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Panel, Toggle } from "@/components/ui";
import { dbError } from "@/lib/db-error";
import { browserClient } from "@/lib/supabase/client";

export type CounterLinkInfo = { code: string; active: boolean; idle_minutes: number; devices: number };
const IDLE_OPTIONS = [5, 10, 15, 30, 60];

/** Link do computador do balcão: a equipe entra tocando no nome e digitando o PIN pessoal. */
export function CounterLink({ pizzeriaId, info, origin }: { pizzeriaId: string; info: CounterLinkInfo | null; origin: string }) {
  const router = useRouter();
  const sb = browserClient();
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const url = info ? `${origin}/balcao/${info.code}` : "";

  useEffect(() => {
    if (!url) return;
    let alive = true;
    import("qrcode").then((q) => q.toDataURL(url, { margin: 1, width: 220 })).then((d) => alive && setQr(d));
    return () => {
      alive = false;
    };
  }, [url]);

  const run = async (fn: () => PromiseLike<{ error: unknown }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) return toast.error(dbError(error));
    toast.success(ok);
    router.refresh();
  };

  if (!info) {
    return (
      <Panel title="Computador do balcão" className="mt-4">
        <p className="text-sm">
          Falta rodar no Supabase o SQL <code className="rounded bg-sand px-1">20261025030000_balcao_pin.sql</code>.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Computador do balcão" className="mt-4">
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="space-y-3 text-sm">
          <p className="text-muted">
            Abra este link no computador ou tablet do balcão. A equipe entra tocando no próprio nome e digitando o <b>PIN pessoal</b> (cada um cria o seu em
            “Meu PIN”). Na troca de turno é só tocar em “Trocar de pessoa”.
          </p>
          <code className={`block break-all rounded-xl bg-sand px-3 py-2 font-mono text-xs ${info.active ? "" : "opacity-50 line-through"}`}>{url}</code>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn !py-2 text-sm"
              disabled={!info.active}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  toast.success("Link do balcão copiado");
                } catch {
                  toast.message(url);
                }
              }}
            >
              <Copy className="h-4 w-4" /> Copiar
            </button>
            <a href={url} target="_blank" rel="noreferrer" className={`btn-ghost !py-2 text-sm ${info.active ? "" : "pointer-events-none opacity-50"}`}>
              <Monitor className="h-4 w-4" /> Abrir aqui
            </a>
          </div>
          <label className="flex items-center justify-between gap-3 border-t pt-3">
            <span>
              <span className="block font-semibold">Sair sozinho depois de</span>
              <span className="text-xs text-muted">Sem ninguém mexer na tela, a pessoa sai e o balcão volta para a lista da equipe.</span>
            </span>
            <select
              className="field !w-auto !py-1.5 text-sm"
              value={info.idle_minutes}
              disabled={busy}
              onChange={(e) => run(() => sb.rpc("set_counter_link", { _pz: pizzeriaId, _active: info.active, _idle_minutes: Number(e.target.value) }), "Tempo salvo")}
            >
              {IDLE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <span>
              <span className="block font-semibold">Link ativo</span>
              <span className="text-xs text-muted">Desligado, ninguém entra pelo balcão (o login com e-mail continua valendo).</span>
            </span>
            <Toggle
              checked={info.active}
              label="Link do balcão ativo"
              disabled={busy}
              onChange={(v) => run(() => sb.rpc("set_counter_link", { _pz: pizzeriaId, _active: v, _idle_minutes: info.idle_minutes }), v ? "Link ligado" : "Link desligado")}
            />
          </div>
          <button
            className="text-xs font-semibold text-muted hover:text-danger"
            disabled={busy}
            onClick={() =>
              confirm("Trocar o link do balcão? O link atual para de funcionar e o computador do balcão precisa abrir o novo.") &&
              run(() => sb.rpc("reset_counter_link", { _pz: pizzeriaId }), "Link do balcão trocado")
            }
          >
            <RefreshCw className="mr-1 inline h-3 w-3" /> Trocar link (se vazou)
          </button>
        </div>
        <div className="text-center">
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR Code do link do balcão" width={180} height={180} className={`mx-auto rounded-xl border bg-paper p-2 ${info.active ? "" : "opacity-40"}`} />
          )}
        </div>
      </div>
    </Panel>
  );
}
