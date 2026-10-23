import type { Quote } from "@/lib/orders";
import type { Fulfillment } from "@/lib/types";
import { brl } from "@/lib/money";

function Row({ l, r, strong }: { l: string; r: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "text-lg font-extrabold" : "text-sm"}`}>
      <span className={strong ? "" : "text-muted"}>{l}</span>
      <span className="text-right font-semibold">{r}</span>
    </div>
  );
}

/** Resumo calculado pelo servidor, com os motivos de bloqueio em destaque. */
export function QuoteSummary({ quote, fulfillment }: { quote: Quote; fulfillment: Fulfillment }) {
  const warnings = [quote.blocked, quote.min_order_error, !quote.delivery.ok ? quote.delivery.reason : null, quote.coupon_error].filter(Boolean);
  return (
    <div className="space-y-2">
      {quote.lines.map((l, i) => (
        <Row key={i} l={`${l.qty}× ${l.name}${l.size_name ? ` (${l.size_name})` : ""}`} r={brl(l.subtotal_cents)} />
      ))}
      <div className="space-y-1.5 border-t pt-2">
        <Row l="Subtotal" r={brl(quote.subtotal_cents)} />
        {quote.discount_cents > 0 && <Row l={`Cupom ${quote.coupon?.code ?? ""}`} r={`− ${brl(quote.discount_cents)}`} />}
        {fulfillment === "entrega" && <Row l="Entrega" r={quote.delivery.ok ? (quote.delivery_fee_cents ? brl(quote.delivery_fee_cents) : "Grátis") : "—"} />}
      </div>
      <div className="border-t pt-2">
        <Row l="Total" r={brl(quote.total_cents)} strong />
      </div>
      {quote.delivery.ok && quote.delivery.eta_min != null && (
        <p className="text-xs text-muted">
          Previsão: {quote.delivery.eta_min}–{quote.delivery.eta_max ?? quote.delivery.eta_min} min
        </p>
      )}
      {warnings.map((w) => (
        <p key={w} className="rounded-xl bg-tomato-soft p-2.5 text-xs font-semibold text-tomato-deep">
          {w}
        </p>
      ))}
    </div>
  );
}
