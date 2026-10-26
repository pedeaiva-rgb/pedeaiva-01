import { createHmac } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Arquivos só de servidor: no teste o "server-only" não precisa barrar nada.
vi.mock("server-only", () => ({}));
vi.mock("../supabase/admin", () => ({ adminClient: () => ({}) }));

const { mapStatus, mpDate, mercadoPago, validSignature } = await import("./mercadopago");
const { decrypt, encrypt, signState, verifyState } = await import("./secrets");

beforeAll(() => {
  process.env.PAYMENTS_SECRET_KEY = "chave-de-teste-com-mais-de-trinta-e-dois-caracteres";
});
afterEach(() => vi.unstubAllGlobals());

describe("Mercado Pago", () => {
  it("traduz a situação do pagamento", () => {
    expect(mapStatus({ status: "approved" })).toBe("pago");
    expect(mapStatus({ status: "pending" })).toBe("pendente");
    expect(mapStatus({ status: "in_process" })).toBe("pendente");
    expect(mapStatus({ status: "cancelled", status_detail: "expired" })).toBe("expirado");
    expect(mapStatus({ status: "rejected" })).toBe("cancelado");
    expect(mapStatus({ status: "refunded" })).toBe("estornado");
    expect(mapStatus({ status: "charged_back" })).toBe("estornado");
  });

  it("manda o prazo no horário de Brasília", () => {
    expect(mpDate(new Date("2026-10-26T15:00:00.000Z"))).toBe("2026-10-26T12:00:00.000-03:00");
  });

  it("confere a assinatura do aviso", () => {
    const secret = "segredo";
    const ts = "1704908010";
    const v1 = createHmac("sha256", secret).update("id:123456;request-id:abc-1;ts:1704908010;").digest("hex");
    expect(validSignature(`ts=${ts},v1=${v1}`, "abc-1", "123456", secret)).toBe(true);
    expect(validSignature(`ts=${ts},v1=${v1}`, "abc-1", "999999", secret)).toBe(false);
    expect(validSignature(null, "abc-1", "123456", secret)).toBe(false);
    // Sem segredo configurado, a segurança fica na consulta ao Mercado Pago.
    expect(validSignature(null, null, null, undefined)).toBe(true);
  });

  it("cria o Pix com o token da loja e devolve o copia e cola", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 987, status: "pending", point_of_interaction: { transaction_data: { qr_code: "000201PIX", qr_code_base64: "AAAA" } } }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetch);
    const r = await mercadoPago.createPix(
      { access_token: "TOKEN-LOJA" },
      {
        charge_id: "c-1",
        amount_cents: 5490,
        description: "Pedido Reserva",
        expires_at: new Date("2026-10-26T15:15:00Z"),
        payer: { name: "Ana", email: "pix@x.com" },
        notification_url: "https://loja.app/api/pagamentos/webhook/mercadopago?c=c-1",
        platform_fee_cents: 0,
      },
    );
    expect(r).toMatchObject({ external_id: "987", qr_code: "000201PIX", qr_image: "data:image/png;base64,AAAA" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.mercadopago.com/v1/payments");
    expect(init.headers.Authorization).toBe("Bearer TOKEN-LOJA");
    expect(init.headers["X-Idempotency-Key"]).toBe("c-1");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ transaction_amount: 54.9, payment_method_id: "pix", external_reference: "c-1" });
    expect(body.application_fee).toBeUndefined();
  });

  it("consulta o pagamento e devolve o valor em centavos e a referência", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1, status: "approved", external_reference: "c-1", transaction_amount: 54.9 }))));
    expect(await mercadoPago.getCharge({ access_token: "T" }, "1")).toEqual({ status: "pago", paid_cents: 5490, reference: "c-1" });
  });

  it("token vencido vira mensagem para conectar de novo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "invalid token" }), { status: 401 })));
    await expect(mercadoPago.getCharge({ access_token: "T" }, "1")).rejects.toThrow(/Conecte a conta de novo/);
  });

  it("lê o aviso: id do pagamento e a nossa cobrança", () => {
    const req = new Request("https://loja.app/api/pagamentos/webhook/mercadopago?c=abc&data.id=555&type=payment", { method: "POST" });
    expect(mercadoPago.parseWebhook(req, JSON.stringify({ type: "payment", data: { id: "555" } }))).toMatchObject({ external_id: "555", charge_id: "abc" });
    const other = new Request("https://loja.app/x?type=merchant_order&data.id=9", { method: "POST" });
    expect(mercadoPago.parseWebhook(other, "").external_id).toBeNull();
  });
});

describe("credenciais e autorização", () => {
  it("cifra e decifra; texto alterado não abre", () => {
    const box = encrypt(JSON.stringify({ access_token: "segredo" }));
    expect(box).not.toContain("segredo");
    expect(JSON.parse(decrypt(box))).toEqual({ access_token: "segredo" });
    const [v, iv, tag, data] = box.split(".");
    expect(() => decrypt([v, iv, tag, data.slice(0, -2) + (data.endsWith("A") ? "B" : "A")].join("."))).toThrow();
  });

  it("state da conexão: assinado, com validade e sem adulteração", () => {
    const s = signState({ pz: "loja-1", uid: "dono-1" });
    expect(verifyState(s)).toEqual({ pz: "loja-1", uid: "dono-1" });
    const [body] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ pz: "outra", uid: "dono-1", exp: 9e9 })).toString("base64url");
    expect(verifyState(`${forged}.${s.split(".")[1]}`)).toBeNull();
    expect(verifyState(`${body}.xx`)).toBeNull();
    expect(verifyState(signState({ pz: "a", uid: "b" }, -1))).toBeNull();
  });
});
