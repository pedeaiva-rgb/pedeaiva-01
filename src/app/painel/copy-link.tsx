"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

export function CopyLink({ slug }: { slug: string }) {
  const copy = async () => {
    const url = `${window.location.origin}/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link da loja copiado");
    } catch {
      toast.message(url);
    }
  };
  return (
    <button onClick={copy} className="btn-ghost !py-2 text-sm">
      <Copy className="h-4 w-4" /> Copiar link da loja
    </button>
  );
}
