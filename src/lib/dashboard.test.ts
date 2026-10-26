import { describe, expect, it } from "vitest";
import { avgDelivery, avgPrep, change, lateOrders, sales, topItems, type DashOrder } from "./dashboard";

const o = (id: string, status: DashOrder["status"], total: number, over: Partial<DashOrder> = {}): DashOrder => ({
  id, status, total_cents: total, created_at: "2026-10-25T20:00:00Z", eta_max: 40, fulfillment: "entrega", dispatched_at: null, delivered_at: null, ...over,
});

describe("visão geral", () => {
  it("vendas contam só confirmados; ticket médio e variação", () => {
    expect(sales([o("a", "entregue", 5000), o("b", "preparo", 3000), o("c", "novo", 9999), o("d", "cancelado", 4000)])).toEqual({
      revenue: 8000, count: 2, avgTicket: 4000, cancelled: 1,
    });
    expect(change(12000, 10000)).toBe(20);
    expect(change(8000, 10000)).toBe(-20);
    expect(change(5000, 0)).toBeNull();
  });
  it("tempos médios de preparo e entrega", () => {
    expect(
      avgPrep([
        { order_id: "a", to_status: "confirmado", created_at: "2026-10-25T20:00:00Z" },
        { order_id: "a", to_status: "pronto", created_at: "2026-10-25T20:20:00Z" },
        { order_id: "b", to_status: "confirmado", created_at: "2026-10-25T20:00:00Z" },
        { order_id: "b", to_status: "pronto", created_at: "2026-10-25T20:30:00Z" },
        { order_id: "c", to_status: "confirmado", created_at: "2026-10-25T20:00:00Z" },
      ]),
    ).toBe(25);
    expect(avgDelivery([o("a", "entregue", 1, { dispatched_at: "2026-10-25T20:30:00Z", delivered_at: "2026-10-25T20:42:00Z" }), o("b", "saiu", 1)])).toBe(12);
    expect(avgPrep([])).toBeNull();
  });
  it("atrasados e mais vendidos", () => {
    const now = new Date("2026-10-25T20:50:00Z").getTime();
    expect(lateOrders([o("a", "preparo", 1), o("b", "entregue", 1), o("c", "pronto", 1, { eta_max: 60 })], now, 30).map((x) => x.id)).toEqual(["a"]);
    expect(
      topItems(
        [
          { order_id: "a", name: "Calabresa", size_name: "Grande", qty: 2 },
          { order_id: "b", name: "Calabresa", size_name: "Grande", qty: 1 },
          { order_id: "b", name: "Coca", size_name: null, qty: 4 },
          { order_id: "x", name: "Cancelada", size_name: null, qty: 9 },
        ],
        new Set(["a", "b"]),
      ),
    ).toEqual([["Coca", 4], ["Calabresa (Grande)", 3]]);
  });
});
