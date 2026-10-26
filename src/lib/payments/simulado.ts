import "server-only";
import type { ChargeState, PaymentProvider } from "./types";

/**
 * Provedor de mentira para testar o fluxo inteiro sem dinheiro de verdade.
 * Só existe com PAYMENTS_SIMULATOR=1 (computador de desenvolvimento) e nunca em produção.
 * O "pagamento" é marcado pelo botão "Simular pagamento" da tela do Pix.
 */
type Sim = { status: ChargeState["status"]; cents: number; ref: string };
const g = globalThis as unknown as { __pavSim?: Map<string, Sim> };
const state = (g.__pavSim ??= new Map<string, Sim>());

export const simulatorEnabled = () => process.env.PAYMENTS_SIMULATOR === "1" && process.env.VERCEL_ENV !== "production";
export function simulatePay(externalId: string) {
  const s = state.get(externalId);
  if (s && s.status === "pendente") s.status = "pago";
}

export const simulado: PaymentProvider = {
  id: "simulado",
  label: "Simulador (teste)",
  modes: ["conta_propria", "subconta"],
  configured: simulatorEnabled,
  async createPix(_c, req) {
    const id = `sim_${req.charge_id}`;
    state.set(id, { status: "pendente", cents: req.amount_cents, ref: req.charge_id });
    return { external_id: id, qr_code: `00020126SIMULADO-PEDE-AI-E-VA-${req.charge_id}`, qr_image: null, expires_at: req.expires_at };
  },
  async getCharge(_c, externalId) {
    const s = state.get(externalId);
    return { status: s?.status ?? "pendente", paid_cents: s?.status === "pago" ? s.cents : null, reference: s?.ref ?? null };
  },
  async refund(_c, externalId) {
    const s = state.get(externalId);
    if (s) s.status = "estornado";
  },
  parseWebhook: () => ({ external_id: null, charge_id: null, valid: false }),
};
