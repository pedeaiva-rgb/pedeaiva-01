"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Archive, ImagePlus, Pencil, Plus, Sparkles, Star, Trash2 } from "lucide-react";
import { ImportDrawer } from "./import-drawer";
import { toast } from "sonner";
import { ProductImage } from "@/components/store/product-image";
import { Drawer, Empty, Field, PageHeader, Panel, Spinner, Toggle } from "@/components/ui";
import { MoneyInput } from "@/components/ui/money-input";
import { dbError } from "@/lib/db-error";
import { uploadProductImage } from "@/lib/image-upload";
import { brl, centsToInput, parseMoney } from "@/lib/money";
import { browserClient } from "@/lib/supabase/client";
import type { Menu, Product } from "@/lib/types";

type Tab = "produtos" | "categorias" | "tamanhos" | "adicionais";
const TABS: [Tab, string][] = [
  ["produtos", "Produtos"],
  ["categorias", "Categorias"],
  ["tamanhos", "Tamanhos"],
  ["adicionais", "Adicionais e bordas"],
];

/** Executa uma alteração no banco, avisa o resultado e recarrega a página. */
function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => PromiseLike<{ error: unknown }>, ok?: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      toast.error(dbError(error));
      return false;
    }
    if (ok) toast.success(ok);
    router.refresh();
    return true;
  };
  return { busy, run };
}

export function MenuManager({ menu }: { menu: Menu }) {
  const [tab, setTab] = useState<Tab>("produtos");
  return (
    <>
      <PageHeader title="Cardápio" subtitle="O que você mudar aqui aparece na loja na hora." />
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map(([id, label]) => (
          <button key={id} data-active={tab === id} onClick={() => setTab(id)} className="chip shrink-0">
            {label}
          </button>
        ))}
      </div>
      {tab === "produtos" && <Products menu={menu} />}
      {tab === "categorias" && <Categories menu={menu} />}
      {tab === "tamanhos" && <Sizes menu={menu} />}
      {tab === "adicionais" && <Extras menu={menu} />}
    </>
  );
}

// ---------------- Produtos ----------------
function Products({ menu }: { menu: Menu }) {
  const { run } = useSave();
  const [editing, setEditing] = useState<Product | "novo" | null>(null);
  const [importing, setImporting] = useState(false);
  const sb = browserClient();
  return (
    <>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <button className="btn-ghost !py-2" onClick={() => setImporting(true)}>
          <Sparkles className="h-4 w-4 text-tomato" /> Importar com IA
        </button>
        <button className="btn !py-2" onClick={() => setEditing("novo")} disabled={menu.categories.length === 0}>
          <Plus className="h-4 w-4" /> Novo produto
        </button>
      </div>
      {importing && <ImportDrawer pizzeriaId={menu.pizzeria.id} onClose={() => setImporting(false)} />}
      {menu.categories.map((c) => {
        const list = menu.products.filter((p) => p.category_id === c.id);
        return (
          <Panel key={c.id} title={`${c.name}${c.active ? "" : " (oculta)"}`} className="mb-4">
            {list.length === 0 ? (
              <Empty>Nenhum produto nesta categoria.</Empty>
            ) : (
              <ul className="divide-y">
                {list.map((p) => {
                  const prices = menu.prices.filter((x) => x.product_id === p.id).map((x) => x.price_cents);
                  const priceText = p.is_pizza ? (prices.length ? `${brl(Math.min(...prices))} – ${brl(Math.max(...prices))}` : "sem preço") : brl(p.price_cents);
                  return (
                    <li key={p.id} className="flex items-center gap-3 py-2.5">
                      <ProductImage src={p.image_url} alt="" size={56} className="w-14 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1 truncate font-bold">
                          {p.name} {p.featured && <Star className="h-3.5 w-3.5 fill-dende text-dende" />}
                        </p>
                        <p className={`text-xs ${priceText === "sem preço" ? "font-bold text-danger" : "text-muted"}`}>{priceText}</p>
                      </div>
                      <Toggle checked={p.available} label={`${p.name} disponível`} onChange={(v) => run(() => sb.from("products").update({ available: v }).eq("id", p.id))} />
                      <button aria-label={`Editar ${p.name}`} onClick={() => setEditing(p)} className="grid h-9 w-9 place-items-center rounded-full bg-sand">
                        <Pencil className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        );
      })}
      {editing && <ProductForm menu={menu} product={editing === "novo" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ProductForm({ menu, product, onClose }: { menu: Menu; product: Product | null; onClose: () => void }) {
  const router = useRouter();
  const sb = browserClient();
  const pz = menu.pizzeria.id;
  const [f, setF] = useState({
    name: product?.name ?? "",
    description: product?.description ?? "",
    category_id: product?.category_id ?? menu.categories[0]?.id ?? "",
    is_pizza: product?.is_pizza ?? true,
    price: product ? centsToInput(product.price_cents) : "",
    available: product?.available ?? true,
    featured: product?.featured ?? false,
    image_url: product?.image_url ?? null,
  });
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      menu.sizes.map((s) => {
        const x = menu.prices.find((pr) => pr.product_id === product?.id && pr.size_id === s.id);
        return [s.id, x ? centsToInput(x.price_cents) : ""];
      }),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      setF((s) => ({ ...s, image_url: null }));
      const url = await uploadProductImage(pz, file);
      setF((s) => ({ ...s, image_url: url }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!f.name.trim()) return toast.error("Informe o nome do produto");
    const price = f.is_pizza ? 0 : parseMoney(f.price || "0");
    if (price == null) return toast.error("Preço inválido");
    const sizePrices = menu.sizes.flatMap((s) => {
      const v = prices[s.id]?.trim();
      if (!v) return [];
      const cents = parseMoney(v);
      return cents == null ? [{ size: s.name, cents: -1 }] : [{ size_id: s.id, size: s.name, cents }];
    });
    const bad = sizePrices.find((x) => x.cents < 0);
    if (bad) return toast.error(`Preço inválido no tamanho ${bad.size}`);
    if (f.is_pizza && sizePrices.length === 0) return toast.error("Informe o preço em pelo menos um tamanho");

    setBusy(true);
    const row = {
      pizzeria_id: pz,
      name: f.name.trim(),
      description: f.description.trim(),
      category_id: f.category_id,
      is_pizza: f.is_pizza,
      price_cents: price,
      available: f.available,
      featured: f.featured,
      image_url: f.image_url,
    };
    const res = product ? await sb.from("products").update(row).eq("id", product.id).select("id").single() : await sb.from("products").insert(row).select("id").single();
    if (res.error) {
      setBusy(false);
      return toast.error(dbError(res.error));
    }
    const id = res.data.id as string;
    if (f.is_pizza) {
      const keep = sizePrices.filter((x): x is { size_id: string; size: string; cents: number } => "size_id" in x);
      const up = keep.length
        ? await sb.from("product_prices").upsert(keep.map((x) => ({ pizzeria_id: pz, product_id: id, size_id: x.size_id, price_cents: x.cents })))
        : { error: null };
      const removed = menu.sizes.filter((s) => !keep.some((k) => k.size_id === s.id)).map((s) => s.id);
      const del = removed.length ? await sb.from("product_prices").delete().eq("product_id", id).in("size_id", removed) : { error: null };
      if (up.error || del.error) {
        setBusy(false);
        return toast.error(dbError(up.error ?? del.error));
      }
    }
    setBusy(false);
    toast.success("Produto salvo");
    router.refresh();
    onClose();
  };

  const archive = async () => {
    if (!product || !confirm(`Tirar "${product.name}" do cardápio? Pedidos antigos continuam com o histórico.`)) return;
    const { error } = await sb.from("products").update({ archived: true, available: false }).eq("id", product.id);
    if (error) return toast.error(dbError(error));
    toast.success("Produto retirado do cardápio");
    router.refresh();
    onClose();
  };

  return (
    <Drawer title={product ? "Editar produto" : "Novo produto"} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          {uploading ? (
            <div className="grid h-24 w-24 place-items-center rounded-2xl bg-sand">
              <Spinner />
            </div>
          ) : (
            <ProductImage src={f.image_url} alt="" size={96} className="w-24" />
          )}
          <div className="space-y-2">
            <label className="btn-ghost cursor-pointer !py-2 text-sm">
              <ImagePlus className="h-4 w-4" /> {f.image_url ? "Trocar foto" : "Enviar foto"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            {f.image_url && (
              <button type="button" className="block text-xs font-bold text-muted" onClick={() => setF({ ...f, image_url: null })}>
                Remover foto
              </button>
            )}
          </div>
        </div>
        <Field label="Nome">
          <input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} />
        </Field>
        <Field label="Descrição">
          <textarea className="field" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={400} placeholder="Ingredientes, tamanho, sabor…" />
        </Field>
        <Field label="Categoria">
          <select className="field" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            {menu.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" data-active={f.is_pizza} onClick={() => setF({ ...f, is_pizza: true })} className="chip !justify-center !rounded-2xl">
            Pizza (preço por tamanho)
          </button>
          <button type="button" data-active={!f.is_pizza} onClick={() => setF({ ...f, is_pizza: false })} className="chip !justify-center !rounded-2xl">
            Item com preço único
          </button>
        </div>
        {f.is_pizza ? (
          <div className="space-y-2 rounded-2xl bg-sand/60 p-3">
            <p className="text-xs font-bold text-muted">Preço em cada tamanho (deixe vazio se não vender)</p>
            {menu.sizes.map((s) => (
              <div key={s.id} className="flex items-center gap-3">
                <span className="w-28 text-sm font-semibold">
                  {s.name}
                  {!s.active && <span className="block text-[10px] text-muted">tamanho oculto</span>}
                </span>
                <MoneyInput aria-label={`Preço ${s.name}`} value={prices[s.id] ?? ""} onChange={(v) => setPrices({ ...prices, [s.id]: v })} />
              </div>
            ))}
          </div>
        ) : (
          <Field label="Preço (R$)">
            <MoneyInput value={f.price} onChange={(v) => setF({ ...f, price: v })} />
          </Field>
        )}
        <label className="flex items-center justify-between gap-3 text-sm font-semibold">
          Disponível para venda <Toggle checked={f.available} label="Disponível" onChange={(v) => setF({ ...f, available: v })} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm font-semibold">
          Mostrar nos destaques <Toggle checked={f.featured} label="Destaque" onChange={(v) => setF({ ...f, featured: v })} />
        </label>
        <button className="btn w-full" disabled={busy || uploading} onClick={save}>
          {busy && <Spinner className="h-4 w-4" />} Salvar produto
        </button>
        {product && (
          <button className="flex items-center gap-1 text-xs font-bold text-danger" onClick={archive}>
            <Archive className="h-3.5 w-3.5" /> Tirar do cardápio
          </button>
        )}
      </div>
    </Drawer>
  );
}

// ---------------- Categorias ----------------
function Categories({ menu }: { menu: Menu }) {
  const { run, busy } = useSave();
  const sb = browserClient();
  const [name, setName] = useState("");
  const list = menu.categories;
  const swap = async (i: number, j: number) => {
    const a = list[i]!;
    const b = list[j]!;
    await run(async () => {
      const r1 = await sb.from("categories").update({ sort: j }).eq("id", a.id);
      const r2 = await sb.from("categories").update({ sort: i }).eq("id", b.id);
      return { error: r1.error ?? r2.error };
    });
  };
  return (
    <Panel title="Categorias" action={<span className="text-xs text-muted">A ordem aqui é a ordem na loja</span>}>
      <ul className="divide-y">
        {list.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2 py-2">
            <div className="flex flex-col">
              <button aria-label="Subir" disabled={i === 0 || busy} onClick={() => swap(i, i - 1)} className="disabled:opacity-30">
                <ArrowUp className="h-4 w-4" />
              </button>
              <button aria-label="Descer" disabled={i === list.length - 1 || busy} onClick={() => swap(i, i + 1)} className="disabled:opacity-30">
                <ArrowDown className="h-4 w-4" />
              </button>
            </div>
            <input
              className="field !py-2"
              defaultValue={c.name}
              maxLength={60}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.name && run(() => sb.from("categories").update({ name: e.target.value.trim() }).eq("id", c.id), "Categoria renomeada")}
            />
            <Toggle checked={c.active} label={`${c.name} visível`} onChange={(v) => run(() => sb.from("categories").update({ active: v }).eq("id", c.id))} />
            <button
              aria-label={`Apagar ${c.name}`}
              onClick={() => confirm(`Apagar a categoria ${c.name}? Só é possível se ela estiver vazia.`) && run(() => sb.from("categories").delete().eq("id", c.id), "Categoria apagada")}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => sb.from("categories").insert({ pizzeria_id: menu.pizzeria.id, name: name.trim(), sort: list.length }), "Categoria criada")) setName("");
        }}
      >
        <input className="field" placeholder="Nova categoria (ex.: Pizzas doces)" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <button className="btn !px-4" disabled={!name.trim() || busy}>
          <Plus className="h-4 w-4" />
        </button>
      </form>
    </Panel>
  );
}

// ---------------- Tamanhos ----------------
function Sizes({ menu }: { menu: Menu }) {
  const { run, busy } = useSave();
  const sb = browserClient();
  const [f, setF] = useState({ name: "", description: "", max: "1" });
  const list = menu.sizes;
  return (
    <Panel title="Tamanhos de pizza" action={<span className="text-xs text-muted">Sabores: quantos cabem em meio a meio</span>}>
      <ul className="divide-y">
        {list.map((s) => (
          <li key={s.id} className="grid grid-cols-[1fr_1fr_90px_auto_auto] items-center gap-2 py-2">
            <input
              aria-label="Nome do tamanho"
              className="field !py-2"
              defaultValue={s.name}
              maxLength={40}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.name && run(() => sb.from("sizes").update({ name: e.target.value.trim() }).eq("id", s.id), "Tamanho salvo")}
            />
            <input
              aria-label="Descrição do tamanho"
              className="field !py-2"
              defaultValue={s.description}
              placeholder="ex.: 8 fatias"
              maxLength={80}
              onBlur={(e) => e.target.value.trim() !== s.description && run(() => sb.from("sizes").update({ description: e.target.value.trim() }).eq("id", s.id), "Tamanho salvo")}
            />
            <select aria-label="Máximo de sabores" className="field !py-2" value={s.max_flavors} onChange={(e) => run(() => sb.from("sizes").update({ max_flavors: Number(e.target.value) }).eq("id", s.id))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} sabor{n > 1 ? "es" : ""}
                </option>
              ))}
            </select>
            <Toggle checked={s.active} label={`${s.name} ativo`} onChange={(v) => run(() => sb.from("sizes").update({ active: v }).eq("id", s.id))} />
            <button
              aria-label={`Apagar ${s.name}`}
              onClick={() => confirm(`Apagar o tamanho ${s.name}? Os preços das pizzas nesse tamanho também serão apagados.`) && run(() => sb.from("sizes").delete().eq("id", s.id), "Tamanho apagado")}
              className="grid h-9 w-9 place-items-center rounded-full text-muted hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-4 grid grid-cols-[1fr_1fr_110px_auto] gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(
            () => sb.from("sizes").insert({ pizzeria_id: menu.pizzeria.id, name: f.name.trim(), description: f.description.trim(), max_flavors: Number(f.max), sort: list.length + 1 }),
            "Tamanho criado",
          );
          if (ok) setF({ name: "", description: "", max: "1" });
        }}
      >
        <input className="field" placeholder="Novo tamanho" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={40} />
        <input className="field" placeholder="Descrição (opcional)" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={80} />
        <select className="field" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} aria-label="Máximo de sabores">
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n} sabor{n > 1 ? "es" : ""}
            </option>
          ))}
        </select>
        <button className="btn !px-4" disabled={!f.name.trim() || busy}>
          <Plus className="h-4 w-4" />
        </button>
      </form>
    </Panel>
  );
}

// ---------------- Adicionais ----------------
/** Preço editável na própria lista: salva ao sair do campo, se mudou. */
function InlineMoney({ label, cents, onCommit }: { label: string; cents: number; onCommit: (cents: number) => void }) {
  const [v, setV] = useState(centsToInput(cents));
  return (
    <MoneyInput
      aria-label={label}
      className="field !py-2"
      value={v}
      onChange={setV}
      onBlur={(cur) => {
        const c = parseMoney(cur || "0");
        if (c == null) return toast.error("Preço inválido");
        if (c !== cents) onCommit(c);
      }}
    />
  );
}

function Extras({ menu }: { menu: Menu }) {
  const { run, busy } = useSave();
  const sb = browserClient();
  const [f, setF] = useState({ name: "", price: "", pizza_only: true });
  return (
    <Panel title="Adicionais e bordas">
      {menu.extras.length === 0 && <Empty>Nenhum adicional ainda. Ex.: Borda de catupiry, Bacon extra.</Empty>}
      <ul className="divide-y">
        {menu.extras.map((x) => (
          <li key={x.id} className="grid grid-cols-[1fr_110px_auto_auto] items-center gap-2 py-2 sm:grid-cols-[1fr_110px_150px_auto_auto]">
            <input
              aria-label="Nome do adicional"
              className="field !py-2"
              defaultValue={x.name}
              maxLength={60}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== x.name && run(() => sb.from("extras").update({ name: e.target.value.trim() }).eq("id", x.id), "Adicional salvo")}
            />
            <InlineMoney
              label={`Preço de ${x.name}`}
              cents={x.price_cents}
              onCommit={(c) => run(() => sb.from("extras").update({ price_cents: c }).eq("id", x.id), "Preço salvo")}
            />
            <label className="hidden items-center gap-2 text-xs font-semibold sm:flex">
              <input type="checkbox" checked={x.pizza_only} onChange={(e) => run(() => sb.from("extras").update({ pizza_only: e.target.checked }).eq("id", x.id))} /> Só para pizza
            </label>
            <Toggle checked={x.available} label={`${x.name} disponível`} onChange={(v) => run(() => sb.from("extras").update({ available: v }).eq("id", x.id))} />
            <button
              aria-label={`Apagar ${x.name}`}
              onClick={() => confirm(`Apagar ${x.name}?`) && run(() => sb.from("extras").delete().eq("id", x.id), "Adicional apagado")}
              className="grid h-9 w-9 place-items-center rounded-full text-muted hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-4 grid grid-cols-[1fr_110px_auto] gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const cents = parseMoney(f.price);
          if (cents == null) return toast.error("Preço inválido");
          const ok = await run(
            () => sb.from("extras").insert({ pizzeria_id: menu.pizzeria.id, name: f.name.trim(), price_cents: cents, pizza_only: f.pizza_only, sort: menu.extras.length }),
            "Adicional criado",
          );
          if (ok) setF({ name: "", price: "", pizza_only: true });
        }}
      >
        <input className="field" placeholder="Novo adicional" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} />
        <MoneyInput aria-label="Preço do novo adicional" value={f.price} onChange={(v) => setF({ ...f, price: v })} />
        <button className="btn !px-4" disabled={!f.name.trim() || !f.price || busy}>
          <Plus className="h-4 w-4" />
        </button>
        <label className="col-span-3 flex items-center gap-2 text-xs font-semibold">
          <input type="checkbox" checked={f.pizza_only} onChange={(e) => setF({ ...f, pizza_only: e.target.checked })} /> Só para pizza (bordas, coberturas)
        </label>
      </form>
    </Panel>
  );
}
