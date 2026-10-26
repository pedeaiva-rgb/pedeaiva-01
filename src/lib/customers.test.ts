import { describe, expect, it } from "vitest";
import { inSegment, message, search, whatsappUrl, type CustomerRow } from "./customers";

const NOW = new Date("2026-10-26T15:00:00Z").getTime();
const ago = (d: number) => new Date(NOW - d * 864e5).toISOString();
let n = 0;
const c = (over: Partial<CustomerRow>): CustomerRow => ({
  id: `c${++n}`,
  name: "Cliente",
  phone: "71999990000",
  birthday: null,
  notes: null,
  marketing_opt_out: false,
  created_at: ago(100),
  orders: 1,
  spent_cents: 5000,
  first_order_at: ago(90),
  last_order_at: ago(90),
  ...over,
});

describe("clientes", () => {
  const list = [
    c({ name: "João Silva", phone: "71988881111", orders: 8, spent_cents: 80000, last_order_at: ago(2) }),
    c({ name: "Maria", orders: 3, spent_cents: 20000, last_order_at: ago(40) }),
    c({ name: "Ana", orders: 1, first_order_at: ago(5), last_order_at: ago(5), birthday: "1990-10-03" }),
    c({ name: "Sem pedido", orders: 0, spent_cents: 0, first_order_at: null, last_order_at: null, birthday: "1985-10-28" }),
  ];

  it("filtros", () => {
    expect(inSegment(list, "melhores", NOW, 10).map((x) => x.name)).toEqual(["João Silva"]);
    expect(inSegment(list, "sumidos", NOW, 10).map((x) => x.name)).toEqual(["Maria"]);
    expect(inSegment(list, "novos", NOW, 10).map((x) => x.name)).toEqual(["Ana"]);
    expect(inSegment(list, "aniversario", NOW, 10).map((x) => x.name)).toEqual(["Ana", "Sem pedido"]);
    expect(inSegment(list, "sem_pedido", NOW, 10).map((x) => x.name)).toEqual(["Sem pedido"]);
  });

  it("busca por nome sem acento e por telefone", () => {
    expect(search(list, "joao").map((x) => x.name)).toEqual(["João Silva"]);
    expect(search(list, "8888").map((x) => x.name)).toEqual(["João Silva"]);
  });

  it("mensagem com primeiro nome, cupom e link", () => {
    const m = message("reativar", { customer: "João Silva", store: "Reserva", coupon: "VOLTA10", link: "https://x/reserva" });
    expect(m).toContain("Oi, João!");
    expect(m).toContain("*VOLTA10*");
    expect(whatsappUrl("71988881111", "a b")).toBe("https://wa.me/5571988881111?text=a%20b");
  });
});
