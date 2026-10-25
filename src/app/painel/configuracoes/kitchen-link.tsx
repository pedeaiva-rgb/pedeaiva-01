"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChefHat, Copy, KeyRound, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Panel, Spinner, Toggle } from "@/components/ui";
import { dbError } from "@/lib/db-error";
import { browserClient } from "@/lib/supabase/client";

export type KitchenLinkInfo = { code: string; active: boolean; has_pin: boolean; devices: number };

/** Link fixo da tela da cozinha (tablet/TV sem login), com QR Code e PIN opcional. */
export function KitchenLink({ pizzeriaId, info, origin }: { pizzeriaId: string; info: KitchenLinkInfo | null; origin: string }) {
  const router = useRouter();
  const sb = browserClient();
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const url = info ? `${origin}/cozinha/${info.code}` : "";

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
      <Panel title="Tela da cozinha" className="mt-4">
        <p className="text-sm">
          Falta rodar no Supabase o SQL <code className="rounded bg-sand px-1">20261025010000_link_cozinha.sql</code>.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Tela da cozinha" className="mt-4">
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="space-y-3 text-sm">
          <p className="text-muted">
            Abra este link no tablet ou na TV da cozinha. Não precisa de login: a tela mostra só os pedidos para preparar e os botões “Iniciar preparo” e “Pronto”.
            Nada de valores, telefones ou endereços.
          </p>
          <code className={`block break-all rounded-xl bg-sand px-3 py-2 font-mono text-xs ${info.active ? "" : "opacity-50 line-through"}`}>{url}</code>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn !py-2 text-sm"
              disabled={!info.active}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  toast.success("Link da cozinha copiado");
                } catch {
                  toast.message(url);
                }
              }}
            >
              <Copy className="h-4 w-4" /> Copiar
            </button>
            <a href={url} target="_blank" rel="noreferrer" className={`btn-ghost !py-2 text-sm ${info.active ? "" : "pointer-events-none opacity-50"}`}>
              <ChefHat className="h-4 w-4" /> Abrir aqui
            </a>
          </div>
          <p className="text-xs text-muted">{info.devices > 0 ? `${info.devices} aparelho(s) com a tela da cozinha aberta agora.` : "Nenhum aparelho com a tela aberta agora."}</p>

          <div className="space-y-2 border-t pt-3">
            <p className="flex items-center gap-1.5 font-semibold">
              <KeyRound className="h-4 w-4" /> PIN da cozinha {info.has_pin ? <span className="rounded-full bg-success-soft px-2 text-xs text-success">ligado</span> : <span className="rounded-full bg-sand px-2 text-xs">desligado</span>}
            </p>
            <p className="text-xs text-muted">Opcional. Com PIN, cada aparelho pede os 4 números uma vez antes de abrir. Mudar o PIN desconecta os aparelhos.</p>
            <div className="flex flex-wrap gap-2">
              <input
                className="field !w-32 text-center font-mono tracking-[0.4em]"
                inputMode="numeric"
                maxLength={4}
                placeholder="0000"
                aria-label="Novo PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
              <button
                className="btn-dark !py-2 text-sm"
                disabled={busy || pin.length !== 4}
                onClick={async () => {
                  await run(() => sb.rpc("set_kitchen_pin", { _pz: pizzeriaId, _pin: pin }), info.has_pin ? "PIN trocado" : "PIN ligado");
                  setPin("");
                }}
              >
                {busy && <Spinner className="h-4 w-4" />} {info.has_pin ? "Trocar PIN" : "Ligar PIN"}
              </button>
              {info.has_pin && (
                <button className="btn-ghost !py-2 text-sm" disabled={busy} onClick={() => run(() => sb.rpc("set_kitchen_pin", { _pz: pizzeriaId, _pin: null }), "PIN desligado")}>
                  Desligar PIN
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <span>
              <span className="block font-semibold">Link ativo</span>
              <span className="text-xs text-muted">Desligado, nenhum aparelho abre a tela da cozinha.</span>
            </span>
            <Toggle
              checked={info.active}
              label="Link da cozinha ativo"
              disabled={busy}
              onChange={(v) => run(() => sb.rpc("set_kitchen_link_active", { _pz: pizzeriaId, _active: v }), v ? "Link ligado" : "Link desligado")}
            />
          </div>
          <button
            className="text-xs font-semibold text-muted hover:text-danger"
            disabled={busy}
            onClick={() =>
              confirm("Trocar o link da cozinha? O link atual para de funcionar e os aparelhos precisam abrir o novo.") &&
              run(() => sb.rpc("reset_kitchen_link", { _pz: pizzeriaId }), "Link da cozinha trocado")
            }
          >
            <RefreshCw className="mr-1 inline h-3 w-3" /> Trocar link (se vazou ou um funcionário saiu)
          </button>
        </div>
        <div className="text-center">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR Code do link da cozinha" width={180} height={180} className={`mx-auto rounded-xl border bg-paper p-2 ${info.active ? "" : "opacity-40"}`} />
          ) : (
            <div className="grid h-[180px] w-[180px] place-items-center rounded-xl bg-sand">
              <Spinner className="h-5 w-5 text-tomato" />
            </div>
          )}
          <p className="mt-1 text-[11px] text-muted">Aponte a câmera do tablet</p>
        </div>
      </div>
    </Panel>
  );
}
