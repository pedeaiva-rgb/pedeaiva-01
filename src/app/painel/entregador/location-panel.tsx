"use client";

import { useState } from "react";
import { AlertTriangle, LocateFixed, Power, Smartphone } from "lucide-react";
import { Spinner } from "@/components/ui";
import type { Gps, GpsStatus, GeoPermission } from "./use-courier-gps";

/** Precisão acima disso costuma ser localização por rede, não pelo GPS. */
const IMPRECISE_M = 100;

/**
 * Turno e localização do entregador: começa/encerra o turno, avisa quando a localização está
 * desligada ou bloqueada e lembra de deixar a página aberta (é um site, não um aplicativo).
 */
export function LocationPanel({
  onDuty,
  enRoute,
  status,
  permission,
  gps,
  onToggle,
  onAsk,
}: {
  onDuty: boolean;
  enRoute: boolean;
  status: GpsStatus;
  permission: GeoPermission;
  gps: Gps | null;
  onToggle: (on: boolean) => Promise<void>;
  onAsk: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  const sharing = onDuty || enRoute;

  if (!sharing) {
    return (
      <div className="card space-y-3 border-2 border-dende p-4">
        <p className="flex items-start gap-2 text-sm font-bold">
          <Power className="h-5 w-5 shrink-0 text-tomato" /> Você está fora do turno
        </p>
        <p className="text-xs text-muted">Ao começar, sua localização passa a ser compartilhada com a loja durante o turno.</p>
        <button className="btn w-full !py-3" disabled={busy} onClick={() => act(() => onToggle(true))}>
          {busy ? <Spinner className="h-4 w-4" /> : <LocateFixed className="h-4 w-4" />} Começar turno e compartilhar localização
        </button>
      </div>
    );
  }

  const blocked = status === "negado" || permission === "denied";
  return (
    <div className="space-y-2">
      {blocked ? (
        <div className="card space-y-2 border-2 border-danger p-4 text-sm">
          <p className="flex items-center gap-2 font-extrabold text-danger">
            <AlertTriangle className="h-5 w-5" /> Sua localização está bloqueada
          </p>
          <p className="text-xs">A loja não consegue ver onde você está. Libere a localização para este site:</p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            <li>
              <b>Android (Chrome):</b> toque no cadeado ao lado do endereço do site → <b>Permissões</b> → <b>Localização</b> → <b>Permitir</b>. Confira também se a
              localização do celular está ligada e com <b>“Localização precisa”</b> ativada.
            </li>
            <li>
              <b>iPhone:</b> Ajustes → <b>Privacidade</b> → <b>Serviços de Localização</b> → ligado; depois Ajustes → <b>Safari</b> → <b>Localização</b> →{" "}
              <b>Permitir</b>.
            </li>
          </ul>
          <button className="btn-ghost w-full !py-2 text-sm" onClick={() => window.location.reload()}>
            Já liberei: recarregar a página
          </button>
        </div>
      ) : status !== "ligado" ? (
        <div className="card space-y-2 border-2 border-dende p-4 text-sm">
          <p className="flex items-center gap-2 font-extrabold text-warning">
            <LocateFixed className="h-5 w-5" /> {status === "indisponivel" ? "O celular não informou a localização" : "Ative sua localização"}
          </p>
          <p className="text-xs">Toque no botão e escolha <b>Permitir</b> quando o celular perguntar. Ligue também a localização (GPS) do celular.</p>
          <button className="btn w-full !py-2.5 text-sm" disabled={busy} onClick={() => act(onAsk)}>
            {busy ? <Spinner className="h-4 w-4" /> : <LocateFixed className="h-4 w-4" />} Ativar localização
          </button>
        </div>
      ) : (
        <div className="card flex items-center gap-2 border-2 border-success p-3 text-xs font-semibold text-success">
          <LocateFixed className="h-5 w-5 shrink-0" />
          <span className="flex-1">
            Localização ao vivo ligada{enRoute ? ": a loja e o cliente veem onde você está." : ": a loja vê que você está disponível."}
          </span>
        </div>
      )}
      {status === "ligado" && gps && gps.accuracy > IMPRECISE_M && (
        <p className="rounded-xl bg-dende-soft px-3 py-2 text-xs font-semibold text-warning">
          Localização imprecisa (~{Math.round(gps.accuracy)} m). Ligue o GPS e a “Localização precisa” do celular e evite ficar dentro de lugar fechado.
        </p>
      )}
      <p className="flex items-start gap-1.5 rounded-xl bg-sand/70 px-3 py-2 text-xs">
        <Smartphone className="h-4 w-4 shrink-0" />
        <b>Deixe esta página aberta na tela durante o turno.</b>
      </p>
      {onDuty && (
        <button
          className="w-full text-center text-xs font-semibold text-muted hover:text-danger disabled:opacity-50"
          disabled={busy || enRoute}
          title={enRoute ? "Termine as entregas em rota antes de encerrar o turno" : undefined}
          onClick={() => confirm("Encerrar o turno? Sua localização deixa de ser compartilhada.") && act(() => onToggle(false))}
        >
          <Power className="mr-1 inline h-3 w-3" /> {enRoute ? "Termine as entregas para encerrar o turno" : "Encerrar turno"}
        </button>
      )}
    </div>
  );
}
