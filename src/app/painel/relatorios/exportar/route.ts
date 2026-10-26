import type { NextRequest } from "next/server";
import { serverNow } from "@/lib/dashboard";
import { CHANNEL_LABEL, PAYMENT_LABEL, PAYMENT_STATUS, STATUS } from "@/lib/order-labels";
import { loadOrders } from "@/lib/report-data";
import { csvMoney, periodFrom, sold, spDay, toCsv } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { allowed, getTenant } from "@/lib/tenant";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

/** Planilha do período (pedidos ou itens), com a sessão da pessoa: as regras de acesso do banco valem. */
export async function GET(req: NextRequest) {
  const t = await getTenant();
  if (!t || !allowed(t, "relatorios")) return new Response("Sem acesso aos relatórios.", { status: 403 });
  const q = req.nextUrl.searchParams;
  const p = periodFrom(q.get("de") ?? undefined, q.get("ate") ?? undefined, spDay(new Date(serverNow())));
  const kind = q.get("tipo") === "itens" ? "itens" : "pedidos";
  const { rows: orders } = await loadOrders(await createClient(), t.pizzeria.id, p);

  const rows: (string | number | null)[][] =
    kind === "pedidos"
      ? [
          ["Pedido", "Data", "Situação", "Canal", "Tipo", "Cliente", "Subtotal", "Desconto", "Cupom", "Entrega", "Total", "Pagamento", "Pagamento situação", "Valeu como venda"],
          ...orders.map((o) => [
            o.number,
            when(o.created_at),
            STATUS[o.status].label,
            CHANNEL_LABEL[o.channel],
            o.tab_id ? "Mesa" : o.fulfillment === "entrega" ? "Entrega" : "Retirada",
            o.customer_name,
            csvMoney(o.subtotal_cents),
            csvMoney(o.discount_cents),
            o.coupon_code ?? "",
            csvMoney(o.delivery_fee_cents),
            csvMoney(o.total_cents),
            PAYMENT_LABEL[o.payment_method],
            PAYMENT_STATUS[o.payment_status as keyof typeof PAYMENT_STATUS]?.label ?? o.payment_status,
            sold(o) ? "Sim" : "Não",
          ]),
        ]
      : [
          ["Pedido", "Data", "Situação", "Produto", "Tamanho", "Quantidade", "Valor"],
          ...orders.flatMap((o) =>
            o.order_items.map((i) => [o.number, when(o.created_at), STATUS[o.status].label, i.name, i.size_name ?? "", i.qty, csvMoney(i.subtotal_cents)]),
          ),
        ];

  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}-${t.pizzeria.slug}-${p.from}-a-${p.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
