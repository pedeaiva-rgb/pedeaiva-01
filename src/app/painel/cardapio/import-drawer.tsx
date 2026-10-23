"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Drawer, Spinner } from "@/components/ui";
import { brl } from "@/lib/money";
import { importMenuItems, parseMenuText, type ImportRow } from "./import-actions";

const KIND_LABEL = { pizza: "Pizza", item: "Item", extra: "Adicional" } as const;
const EXAMPLE = `Pizzas (Broto / Média / Grande / Família)
Calabresa - calabresa, cebola e orégano - 31,90 / 42,90 / 54,90 / 69,90
Margherita - mussarela de búfala e manjericão - 32,90 / 44,90 / 56,90 / 72,90

Bebidas
Coca-Cola lata 350 ml - 6,00
Guaraná 2 L - 12,00

Adicionais (só para pizza)
Borda de catupiry - 8,00`;

const importable = (r: ImportRow) => (r.kind === "pizza" ? r.prices.length > 0 : r.price_cents != null);

export function ImportDrawer({ pizzeriaId, onClose }: { pizzeriaId: string; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [chosen, setChosen] = useState<boolean[]>([]);
  const [busy, setBusy] = useState<"lendo" | "salvando" | null>(null);

  const read = async () => {
    setBusy("lendo");
    const r = await parseMenuText(pizzeriaId, text);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    setRows(r.data);
    setChosen(r.data.map(importable));
  };

  const save = async () => {
    if (!rows) return;
    const picked = rows.filter((_, i) => chosen[i]);
    if (picked.length === 0) return toast.error("Marque ao menos um item para cadastrar.");
    setBusy("salvando");
    const r = await importMenuItems(pizzeriaId, picked);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    const { created, updated, skipped } = r.data;
    toast.success(`${created} cadastrado(s)${updated ? `, ${updated} atualizado(s)` : ""}`);
    if (skipped.length) toast.warning(`Não cadastrados: ${skipped.join(", ")}`, { duration: 10000 });
    router.refresh();
    onClose();
  };

  const count = chosen.filter(Boolean).length;
  return (
    <Drawer title="Importar cardápio com IA" onClose={onClose} wide>
      {!rows ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Cole a lista do cardápio do jeito que você tiver: pizzas com o preço de cada tamanho, bebidas, sobremesas e adicionais. A IA separa tudo e mostra para você conferir antes de cadastrar. Nada é salvo sem sua confirmação.
          </p>
          <textarea className="field font-mono text-xs" rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} maxLength={20000} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="text-xs font-bold text-muted hover:text-ink" onClick={() => setText(EXAMPLE)}>
              Usar um exemplo
            </button>
            <button className="btn" disabled={busy != null || text.trim().length < 10} onClick={read}>
              {busy === "lendo" ? <Spinner className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />} {busy === "lendo" ? "Lendo a lista…" : "Ler lista"}
            </button>
          </div>
          {busy === "lendo" && <p className="text-xs text-muted">Pode levar alguns segundos.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Confira o que a IA leu. Desmarque o que não quiser. Produto com o mesmo nome de um que já existe é <b>atualizado</b>, não duplicado.
          </p>
          <ul className="divide-y rounded-2xl bg-surface px-3 shadow-[var(--shadow-soft)]">
            {rows.map((r, i) => (
              <li key={i} className="flex items-start gap-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  aria-label={`Cadastrar ${r.name}`}
                  disabled={!importable(r)}
                  checked={chosen[i] ?? false}
                  onChange={(e) => setChosen(chosen.map((c, j) => (j === i ? e.target.checked : c)))}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {r.name}{" "}
                    <span className="rounded-full bg-sand px-2 py-0.5 text-[10px] font-bold text-muted">
                      {KIND_LABEL[r.kind]}
                      {r.kind !== "extra" ? ` · ${r.category}` : r.pizza_only ? " · só pizza" : ""}
                    </span>
                  </p>
                  {r.description && <p className="text-xs text-muted">{r.description}</p>}
                  <p className="text-xs font-semibold">
                    {r.kind === "pizza" ? r.prices.map((p) => `${p.size} ${brl(p.price_cents)}`).join(" · ") : r.price_cents != null ? brl(r.price_cents) : ""}
                  </p>
                  {r.warnings.map((w) => (
                    <p key={w} className="flex items-center gap-1 text-xs font-semibold text-warning">
                      <AlertTriangle className="h-3 w-3" /> {w}
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap justify-between gap-2">
            <button className="btn-ghost" disabled={busy != null} onClick={() => setRows(null)}>
              Voltar e editar a lista
            </button>
            <button className="btn" disabled={busy != null || count === 0} onClick={save}>
              {busy === "salvando" && <Spinner className="h-4 w-4" />} Cadastrar {count} item(ns)
            </button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
