import type { Channel, Fulfillment, OrderStatus, PaymentMethod, PaymentStatus, Role } from "./types";

export const STATUS: Record<OrderStatus, { label: string; cls: string }> = {
  novo: { label: "Novo", cls: "bg-info-soft text-info" },
  confirmado: { label: "Confirmado", cls: "bg-sand text-ink" },
  preparo: { label: "Em preparo", cls: "bg-warning-soft text-warning" },
  pronto: { label: "Pronto", cls: "bg-success-soft text-success" },
  saiu: { label: "Saiu para entrega", cls: "bg-tomato-soft text-tomato-deep" },
  entregue: { label: "Entregue", cls: "bg-success text-paper" },
  cancelado: { label: "Cancelado", cls: "bg-sand text-muted line-through" },
};

/** Espelho de public.allowed_transition (o banco é quem decide). */
export function nextStatus(f: Fulfillment, s: OrderStatus): OrderStatus | null {
  if (s === "novo") return "confirmado";
  if (s === "confirmado") return "preparo";
  if (s === "preparo") return "pronto";
  if (s === "pronto") return f === "entrega" ? "saiu" : "entregue";
  if (s === "saiu") return "entregue";
  return null;
}

export const flowFor = (f: Fulfillment): OrderStatus[] =>
  f === "entrega" ? ["novo", "confirmado", "preparo", "pronto", "saiu", "entregue"] : ["novo", "confirmado", "preparo", "pronto", "entregue"];

export const ACTION_LABEL: Record<OrderStatus, string> = {
  novo: "",
  confirmado: "Confirmar pedido",
  preparo: "Iniciar preparo",
  pronto: "Marcar como pronto",
  saiu: "Saiu para entrega",
  entregue: "Marcar como entregue",
  cancelado: "Cancelar",
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = { pix: "Pix", cartao: "Cartão", dinheiro: "Dinheiro" };
export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; cls: string }> = {
  pendente: { label: "A receber", cls: "bg-warning-soft text-warning" },
  recebido: { label: "Recebido", cls: "bg-success-soft text-success" },
  estornado: { label: "Estornado", cls: "bg-sand text-muted" },
};
export const CHANNEL_LABEL: Record<Channel, string> = { site: "Loja online", balcao: "Balcão", telefone: "Telefone", whatsapp: "WhatsApp" };
export const ROLE_LABEL: Record<Role, string> = {
  owner: "Proprietário",
  manager: "Gerente",
  cashier: "Caixa",
  attendant: "Atendente",
  kitchen: "Cozinha",
  driver: "Entregador",
};
