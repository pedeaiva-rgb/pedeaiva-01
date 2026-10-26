/**
 * Camada única de pagamentos online. Cada provedor (Mercado Pago hoje; Tuna, Pagar.me, Asaas... depois)
 * implementa `PaymentProvider`, e o resto do sistema não sabe qual está por trás.
 *
 * Dois jeitos de a loja receber:
 * - "conta_propria": a pizzaria conecta a conta dela no provedor (o dinheiro cai direto com ela).
 * - "subconta": a plataforma cria uma subconta para a loja numa conta-mãe e divide o valor (split).
 */
export type ProviderId = "mercadopago" | "simulado";
export type AccountMode = "conta_propria" | "subconta";

/** Credenciais da loja no provedor (guardadas criptografadas em public.payment_secrets). */
export type Credentials = {
  access_token?: string;
  refresh_token?: string;
  /** Validade do access_token (ISO). */
  expires_at?: string;
  /** Subconta: identificador dela na conta-mãe da plataforma. */
  subaccount_id?: string;
  [k: string]: unknown;
};

export type PaymentAccount = {
  pizzeria_id: string;
  provider: ProviderId;
  mode: AccountMode;
  status: "ativa" | "pendente" | "desconectada" | "erro";
  external_account_id: string | null;
  account_label: string | null;
};

export type PixRequest = {
  /** Nosso id da cobrança: volta do provedor como referência externa. */
  charge_id: string;
  amount_cents: number;
  description: string;
  expires_at: Date;
  payer: { name: string; email: string };
  /** Onde o provedor avisa do pagamento (vazio no computador de teste, sem endereço público). */
  notification_url: string | null;
  /** Parte da plataforma em cada Pix (0 = nada). */
  platform_fee_cents: number;
};

export type PixCharge = { external_id: string; qr_code: string; qr_image: string | null; expires_at: Date };

/** Situação da cobrança no provedor, já traduzida. */
export type ChargeState = {
  status: "pendente" | "pago" | "expirado" | "cancelado" | "estornado";
  paid_cents: number | null;
  /** Referência que mandamos ao criar (confere que a cobrança é mesmo a nossa). */
  reference: string | null;
};

export type ConnectedAccount = { credentials: Credentials; external_account_id: string; account_label: string };

export interface PaymentProvider {
  id: ProviderId;
  label: string;
  modes: AccountMode[];
  /** Pronto para uso neste servidor (chaves configuradas)? */
  configured(): boolean;
  /** Conta própria: endereço para a loja autorizar a conexão. */
  authorizeUrl?(state: string, redirectUri: string): string;
  /** Conta própria: troca o código da autorização pelas credenciais. */
  connect?(code: string, redirectUri: string): Promise<ConnectedAccount>;
  /** Renova as credenciais perto de vencer (devolve null se não precisa). */
  refresh?(c: Credentials): Promise<Credentials | null>;
  createPix(c: Credentials, req: PixRequest): Promise<PixCharge>;
  getCharge(c: Credentials, externalId: string): Promise<ChargeState>;
  refund(c: Credentials, externalId: string, idempotencyKey: string): Promise<void>;
  /**
   * Lê o aviso (webhook) do provedor e diz qual cobrança mudou. Não confia no conteúdo:
   * quem chama sempre consulta a cobrança no provedor antes de dar como paga.
   */
  parseWebhook(req: Request, body: string): { external_id: string | null; charge_id: string | null; valid: boolean };
}

export class PaymentError extends Error {}
