import { describe, expect, it } from "vitest";
import { isWithinHours, parseHours, storeStatus } from "./hours";
import { maskMoney } from "@/components/ui/money-input";
import { maskPhone } from "@/components/ui/phone-input";
import { brl, centsToInput, parseMoney } from "./money";
import { formatBrPhone, normalizeBrPhone } from "./phone";
import { hideCpf, maskCpf, validCpf } from "./cpf";
import { addressQueries } from "./address-queries";
import { distanceKm, etaMinutes, formatKm, googleRouteUrl, planRoute } from "./geo";

describe("mapa", () => {
  const loja = { lat: -12.97, lng: -38.5 };
  it("distância e tempo", () => {
    expect(distanceKm(loja, { lat: -12.98, lng: -38.5 })).toBeCloseTo(1.11, 1);
    expect(etaMinutes(0)).toBe(2);
    expect(etaMinutes(5)).toBe(19);
    expect(formatKm(0.42)).toBe("420 m");
    expect(formatKm(3.25)).toBe("3,3 km");
  });
  it("ordem sugerida vai sempre para a parada mais perto", () => {
    const stops = [
      { n: "longe", p: { lat: -13.05, lng: -38.5 } },
      { n: "sem mapa", p: null },
      { n: "perto", p: { lat: -12.98, lng: -38.5 } },
      { n: "meio", p: { lat: -13.01, lng: -38.5 } },
    ];
    expect(planRoute(loja, stops, (s) => s.p).map((s) => s.n)).toEqual(["perto", "meio", "longe", "sem mapa"]);
    expect(planRoute(null, stops, (s) => s.p).map((s) => s.n)).toEqual(["longe", "perto", "meio", "sem mapa"]);
  });
  it("endereço da loja vira consultas do mais preciso ao mais geral", () => {
    expect(addressQueries("em frente ao cond.reserva parque - R. Col. Boa União - Catu de Abrantes, Camaçari - BA, 42821-798")).toEqual([
      "Rua Col. Boa União, Catu de Abrantes, Camaçari, BA",
      "Catu de Abrantes, Camaçari, BA",
      "Camaçari, BA",
    ]);
    expect(addressQueries("Av. Sete de Setembro, 1000, Centro, Salvador - BA")[0]).toBe("Avenida Sete de Setembro, 1000, Centro, Salvador, BA");
    expect(addressQueries("Salvador")).toEqual(["Salvador"]);
  });
  it("rota no Google Maps com paradas", () => {
    const u = new URL(googleRouteUrl(["Rua A, 1", "Rua B, 2", "Rua C, 3"])!);
    expect(u.searchParams.get("destination")).toBe("Rua C, 3");
    expect(u.searchParams.get("waypoints")).toBe("Rua A, 1|Rua B, 2");
    expect(googleRouteUrl([])).toBeNull();
  });
});

describe("CPF", () => {
  it.each([
    ["529.982.247-25", true],
    ["52998224725", true],
    ["529.982.247-24", false],
    ["111.111.111-11", false],
    ["1234", false],
    ["", false],
  ])("%s válido? %s", (raw, ok) => expect(validCpf(raw)).toBe(ok));
  it("máscara e ocultação", () => {
    expect(maskCpf("529")).toBe("529");
    expect(maskCpf("5299822")).toBe("529.982.2");
    expect(maskCpf("52998224725999")).toBe("529.982.247-25");
    expect(hideCpf("52998224725")).toBe("***.982.247-**");
  });
});

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
  it.each([
    ["7", "(7"],
    ["71", "(71"],
    ["719", "(71) 9"],
    ["71999990001", "(71) 99999-0001"],
    ["7134567890", "(71) 3456-7890"],
    ["7199999000199999", "(71) 99999-0001"], // para no 11º dígito
    ["+55 71 99999-0001", "(71) 99999-0001"],
    ["071 3456-7890", "(71) 3456-7890"],
    ["abc", ""],
  ])("máscara: %s → %s", (typed, out) => expect(maskPhone(typed)).toBe(out));
  it("o telefone mascarado continua válido para o sistema", () => {
    expect(normalizeBrPhone(maskPhone("71999990001"))).toBe("71999990001");
    expect(normalizeBrPhone(maskPhone("7134567890"))).toBe("7134567890");
  });
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
  it.each([
    ["4290", "42,90"],
    ["R$ 42,905", "429,05"], // digitou mais um número depois do valor
    ["5", "0,05"],
    ["123456", "1.234,56"],
    ["000", ""],
    ["", ""],
  ])("máscara: %s → %s", (typed, out) => expect(maskMoney(typed)).toBe(out));
  it("o valor da máscara volta a ser centavos", () => {
    expect(parseMoney(maskMoney("123456"))).toBe(123456);
    expect(parseMoney(centsToInput(4290))).toBe(4290);
  });
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
