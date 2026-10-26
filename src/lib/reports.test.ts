import { describe, expect, it } from "vitest";
import {
  byCourier,
  byDay,
  byField,
  byHour,
  bySeller,
  byService,
  byWeekday,
  coupons,
  csvMoney,
  periodFrom,
  previousPeriod,
  products,
  serviceByWaiter,
  summary,
  toCsv,
  type ROrder,
} from "./reports";

let n = 0;
const order = (over: Partial<ROrder> = {}): ROrder => ({
  id: `o${++n}`,
  number: n,
  status: "entregue",
  channel: "site",
  fulfillment: "retirada",
  payment_method: "pix",
  payment_status: "recebido",
  subtotal_cents: 5000,
  discount_cents: 0,
  delivery_fee_cents: 0,
  total_cents: 5000,
  coupon_code: null,
  customer_name: "Ana",
  created_at: "2026-10-20T23:30:00.000Z", // 20:30 em Brasília, terça
  created_by: null,
  courier_id: null,
  tab_id: null,
  eta_max: null,
  dispatched_at: null,
  delivered_at: null,
  order_items: [{ name: "Calabresa", size_name: "Grande", qty: 1, subtotal_cents: 5000, product_id: "p1" }],
  ...over,
});

describe("período", () => {
  it("dias de Brasília, inclusivo, e o anterior do mesmo tamanho", () => {
    const p = periodFrom("2026-10-20", "2026-10-26", "2026-10-26");
    expect(p.days).toBe(7);
    expect(p.start.toISOString()).toBe("2026-10-20T03:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-10-27T03:00:00.000Z");
    const prev = previousPeriod(p);
    expect([prev.from, prev.to, prev.days]).toEqual(["2026-10-13", "2026-10-19", 7]);
    expect(prev.end.getTime()).toBe(p.start.getTime());
  });

  it("datas inválidas viram os últimos 7 dias; invertidas são trocadas; longas são cortadas", () => {
    expect(periodFrom("xx", undefined, "2026-10-26")).toMatchObject({ from: "2026-10-20", to: "2026-10-26" });
    expect(periodFrom("2026-10-26", "2026-10-01", "2026-10-26")).toMatchObject({ from: "2026-10-01", to: "2026-10-26" });
    expect(periodFrom("2020-01-01", "2026-10-26", "2026-10-26", 30).days).toBe(30);
  });
});

describe("contas", () => {
  const orders = [
    order(),
    order({ total_cents: 3000, discount_cents: 500, coupon_code: "BEMVINDO", channel: "balcao", created_by: "u1", payment_method: "dinheiro" }),
    order({ status: "cancelado", total_cents: 7000 }),
    order({ status: "novo", total_cents: 9000 }),
    order({ fulfillment: "entrega", delivery_fee_cents: 800, total_cents: 5800, courier_id: "c1", created_at: "2026-10-22T15:00:00.000Z" }),
    order({ tab_id: "t1", channel: "mesa", total_cents: 4000, created_by: "u2" }),
  ];

  it("resumo: só pedidos que valeram, cancelados à parte, taxa de serviço das mesas", () => {
    const s = summary(orders, [{ id: "t1", opened_by: "u2", service_fee_pct: 10, subtotal_cents: 4000 }]);
    expect(s).toMatchObject({ revenue: 17800, count: 4, avgTicket: 4450, cancelledCount: 1, cancelledValue: 7000, discounts: 500, deliveryFees: 800, serviceFee: 400 });
  });

  it("por dia preenche os dias vazios; por hora e dia da semana no horário de Brasília", () => {
    const p = periodFrom("2026-10-20", "2026-10-22", "2026-10-22");
    const d = byDay(orders, p);
    expect(d.map((x) => [x.label, x.revenue])).toEqual([
      ["20/10", 12000],
      ["21/10", 0],
      ["22/10", 5800],
    ]);
    const h = byHour(orders);
    expect(h).toHaveLength(24);
    expect(h[20]).toMatchObject({ label: "20h", count: 3 });
    expect(h[12]).toMatchObject({ count: 1 });
    expect(byWeekday(orders)[2]).toMatchObject({ label: "Terça", count: 3 });
  });

  it("canais, formas de pagamento e tipo de serviço", () => {
    expect(byField(orders, "channel", { site: "Loja online", balcao: "Balcão", mesa: "Mesa" }).map((b) => [b.label, b.count])).toEqual([
      ["Loja online", 2],
      ["Mesa", 1],
      ["Balcão", 1],
    ]);
    expect(byService(orders).map((b) => b.key).sort()).toEqual(["entrega", "mesa", "retirada"]);
  });

  it("produtos e categorias somam só o que valeu", () => {
    const r = products(orders, (id) => (id === "p1" ? "Pizzas" : "Outros"));
    expect(r.items[0]).toEqual({ name: "Calabresa (Grande)", qty: 4, revenue: 20000 });
    expect(r.categories).toEqual([{ name: "Pizzas", qty: 4, revenue: 20000 }]);
  });

  it("equipe, garçons, entregadores e cupons", () => {
    const names = (id: string) => ({ u1: "Caio", u2: "Gabi", c1: "Rafa" })[id] ?? "?";
    expect(bySeller(orders, names).map((r) => r.name)).toEqual(["Loja online", "Gabi", "Caio"]);
    expect(serviceByWaiter([{ id: "t1", opened_by: null, service_fee_pct: 10, subtotal_cents: 4000 }], names)[0]).toMatchObject({ name: "Aberta pelo cliente (QR)", extra: 400 });
    expect(byCourier(orders, names)).toEqual([{ name: "Rafa", count: 1, revenue: 5800, extra: 800 }]);
    expect(coupons(orders)).toEqual([{ name: "BEMVINDO", count: 1, revenue: 500, extra: 3000 }]);
  });
});

describe("planilha", () => {
  it("separador ;, vírgula decimal, aspas e fórmulas neutralizadas", () => {
    const csv = toCsv([
      ["Cliente", "Total"],
      ['Ana "Bia"; Silva', csvMoney(12345)],
      ["=HYPERLINK(1)", csvMoney(-500)],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Ana ""Bia""; Silva";123,45');
    expect(csv).toContain("'=HYPERLINK(1);-5,00");
  });
});
