"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { Empty, PageHeader } from "@/components/ui";

/** Um cartão por mesa (cabem 6 por folha A4): QR grande, número da mesa e o que o cliente pode fazer. */
export function QrSheet({ storeName, tables }: { storeName: string; tables: { id: string; name: string; url: string }[] }) {
  const [images, setImages] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    import("qrcode").then(async (q) => {
      const out: Record<string, string> = {};
      for (const t of tables) out[t.id] = await q.toDataURL(t.url, { margin: 1, width: 360, errorCorrectionLevel: "M" });
      if (alive) setImages(out);
    });
    return () => {
      alive = false;
    };
  }, [tables]);

  return (
    <>
      <PageHeader
        title="QR Codes das mesas"
        subtitle="Imprima, recorte e cole cada um na sua mesa. Dica: plastifique ou use um display de acrílico."
        actions={
          <button className="btn !py-2 text-sm" onClick={() => window.print()} disabled={!tables.length}>
            <Printer className="h-4 w-4" /> Imprimir
          </button>
        }
      />
      {tables.length === 0 ? (
        <Empty>Nenhuma mesa ativa cadastrada.</Empty>
      ) : (
        <div id="qr-sheet" className="grid grid-cols-2 gap-4 md:grid-cols-3 print:grid-cols-2 print:gap-6">
          {tables.map((t) => (
            <div key={t.id} className="qr-card flex flex-col items-center rounded-2xl border-2 border-dashed border-line bg-paper p-4 text-center">
              <p className="text-sm font-bold">{storeName}</p>
              <p className="font-brand text-4xl leading-tight font-extrabold">Mesa {t.name}</p>
              {images[t.id] ? (
                // eslint-disable-next-line @next/next/no-img-element -- QR gerado no navegador (data URL)
                <img src={images[t.id]} alt={`QR Code da Mesa ${t.name}`} className="my-2 aspect-square w-full max-w-[200px]" />
              ) : (
                <div className="my-2 aspect-square w-full max-w-[200px] animate-pulse rounded-xl bg-sand" />
              )}
              <p className="text-sm font-bold">Aponte a câmera do celular</p>
              <p className="text-xs">Veja o cardápio, faça o pedido, chame o garçom e peça a conta</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
