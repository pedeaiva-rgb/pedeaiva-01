import { describe, expect, it } from "vitest";
import { isWithinHours, parseHours, storeStatus } from "./hours";
import { brl, parseMoney } from "./money";
import { formatBrPhone, normalizeBrPhone } from "./phone";

// Datas em UTC; São Paulo = UTC−3. 2026-10-21 é uma quarta-feira (dia 3).
const sp = (isoLocal: string) => new Date(`${isoLocal}-03:00`);

describe("telefone", () => {
  it.each([
    ["71999990001", "71999990001"],
    ["(71) 99999-0001", "71999990001"],
    ["+55 71 99999-0001", "71999990001"],
    ["071 3456-7890", "7134567890"],
    ["71 89999-0001", null], // celular precisa começar com 9
    ["20 99999-0001", null], // DDD inexistente
    ["1234", null],
    ["71 9999-abc", null],
  ])("%s → %s", (raw, out) => expect(normalizeBrPhone(raw)).toBe(out));
  it("formata para exibição", () => {
    expect(formatBrPhone("71999990001")).toBe("(71) 99999-0001");
    expect(formatBrPhone("7134567890")).toBe("(71) 3456-7890");
  });
});

describe("dinheiro", () => {
  it.each([
    ["12,50", 1250],
    ["12.5", 1250],
    ["R$ 1.234,56", 123456],
    ["0", 0],
    ["abc", null],
    ["", null],
    ["1,234", null],
  ])("%s → %s", (raw, out) => expect(parseMoney(raw)).toBe(out));
  it("exibe em reais", () => expect(brl(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56"));
});

describe("horário da loja", () => {
  const hours = parseHours({ "3": [{ open: "18:00", close: "02:00" }], "4": [{ open: "11:00", close: "14:00" }], "5": [{ open: "x", close: "y" }] });
  it("ignora intervalos mal formados", () => expect(Object.keys(hours)).toEqual(["3", "4"]));
  it("abre e fecha no minuto certo, inclusive depois da meia-noite", () => {
    expect(isWithinHours(hours, sp("2026-10-21T17:59:00"))).toBe(false);
    expect(isWithinHours(hours, sp("2026-10-21T18:00:00"))).toBe(true);
    expect(isWithinHours(hours, sp("2026-10-22T01:59:00"))).toBe(true);
    expect(isWithinHours(hours, sp("2026-10-22T02:00:00"))).toBe(false);
    expect(isWithinHours(hours, sp("2026-10-22T12:00:00"))).toBe(true);
  });
  it("pausa manual vence; sem horário cadastrado, vale só a pausa", () => {
    expect(storeStatus({ accepting_orders: false, opening_hours: {} })).toMatchObject({ open: false, reason: "pausada" });
    expect(storeStatus({ accepting_orders: true, opening_hours: {} })).toEqual({ open: true });
    expect(storeStatus({ accepting_orders: true, opening_hours: { "3": [{ open: "18:00", close: "23:00" }] } }, sp("2026-10-21T10:00:00"))).toMatchObject({
      open: false,
      reason: "fora_do_horario",
    });
  });
});
