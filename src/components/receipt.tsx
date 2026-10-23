import { brl } from "@/lib/money";
import { CHANNEL_LABEL, PAYMENT_LABEL, PAYMENT_STATUS } from "@/lib/order-labels";
import { formatBrPhone } from "@/lib/phone";
import type { Order, OrderItem } from "@/lib/types";

/** Comprovante não fiscal (impressora térmica de 80 mm ou PDF pelo navegador). */
export function Receipt({ order, items, storeName }: { order: Order; items: OrderItem[]; storeName: string }) {
  const a = order.address;
  return (
    <div id="comprovante" className="font-mono text-xs leading-relaxed text-ink">
      <p className="text-center text-sm font-bold">{storeName}</p>
      <p className="mt-1 text-center text-base font-bold">PEDIDO #{order.number}</p>
      <p className="text-center">
        {new Date(order.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })} · {CHANNEL_LABEL[order.channel]}
      </p>
      <p className="text-center font-bold">{order.fulfillment === "entrega" ? "ENTREGA" : "RETIRADA"}</p>
      <div className="my-2 border-t border-dashed border-ink" />
      <p>{order.customer_name}</p>
      {order.customer_phone && <p>{formatBrPhone(order.customer_phone)}</p>}
      {a && (
        <p>
          {a.street}, {a.number}
          {a.complement ? ` – ${a.complement}` : ""} – {a.neighborhood}
          {a.reference ? ` (${a.reference})` : ""}
        </p>
      )}
      <div className="my-2 border-t border-dashed border-ink" />
      {items.map((i) => (
        <div key={i.id} className="mb-1">
          <div className="flex justify-between gap-2">
            <span>
              {i.qty}× {i.name}
              {i.size_name ? ` (${i.size_name})` : ""}
            </span>
            <span>{brl(i.subtotal_cents)}</span>
          </div>
          {i.extras.length > 0 && <p className="pl-3">+ {i.extras.map((e) => e.name).join(", ")}</p>}
          {i.note && <p className="pl-3 italic">Obs.: {i.note}</p>}
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-ink" />
      <div className="flex justify-between">
        <span>Subtotal</span>
        <span>{brl(order.subtotal_cents)}</span>
      </div>
      {order.discount_cents > 0 && (
        <div className="flex justify-between">
          <span>Desconto {order.coupon_code ?? ""}</span>
          <span>− {brl(order.discount_cents)}</span>
        </div>
      )}
      {order.fulfillment === "entrega" && (
        <div className="flex justify-between">
          <span>Entrega</span>
          <span>{brl(order.delivery_fee_cents)}</span>
        </div>
      )}
      <div className="flex justify-between text-sm font-bold">
        <span>TOTAL</span>
        <span>{brl(order.total_cents)}</span>
      </div>
      <p className="mt-1">
        Pagamento: {PAYMENT_LABEL[order.payment_method]} · {PAYMENT_STATUS[order.payment_status].label}
        {order.change_for_cents ? ` · troco para ${brl(order.change_for_cents)}` : ""}
      </p>
      {order.notes && <p className="mt-1">Obs.: {order.notes}</p>}
      <p className="mt-3 text-center text-[10px]">Documento sem valor fiscal</p>
    </div>
  );
}
