import { z } from "zod";
import { normalizeBrPhone, PHONE_ERROR } from "./phone";

/** Formato aceito do navegador. O preço NUNCA vem daqui: o servidor recalcula tudo. */
export const lineSchema = z.object({
  product_id: z.uuid(),
  size_id: z.uuid().nullable().optional(),
  flavor_ids: z.array(z.uuid()).max(4).optional(),
  extra_ids: z.array(z.uuid()).max(10).optional(),
  qty: z.number().int().min(1).max(50),
  note: z.string().max(200).nullable().optional(),
});

export const quoteSchema = z.object({
  items: z.array(lineSchema).min(1, "A sacola está vazia").max(40),
  fulfillment: z.enum(["entrega", "retirada"]),
  neighborhood: z.string().max(80).default(""),
  coupon: z.string().max(40).default(""),
});

export const addressSchema = z.object({
  street: z.string().trim().max(120),
  number: z.string().trim().max(20),
  complement: z.string().trim().max(80).default(""),
  neighborhood: z.string().trim().max(80),
  reference: z.string().trim().max(120).default(""),
});

const checkoutBase = quoteSchema.extend({
  idempotency_key: z.string().min(16).max(80),
  address: addressSchema.nullable(),
  payment_method: z.enum(["pix", "cartao", "dinheiro"]),
  change_for_cents: z.number().int().min(0).max(100_000_00).nullable().default(null),
  notes: z.string().trim().max(300).default(""),
});

export const siteOrderSchema = checkoutBase.extend({
  slug: z.string().min(3).max(40),
  customer_name: z.string().trim().min(2, "Informe seu nome").max(80),
  customer_phone: z.string().trim().max(25).refine((v) => normalizeBrPhone(v) !== null, PHONE_ERROR),
  /** Campo escondido: só robôs preenchem. */
  website: z.string().max(200).default(""),
});

export const pdvOrderSchema = checkoutBase.extend({
  pizzeria_id: z.uuid(),
  channel: z.enum(["balcao", "telefone", "whatsapp"]),
  customer_name: z.string().trim().max(80).default(""),
  customer_phone: z
    .string()
    .trim()
    .max(25)
    .default("")
    .refine((v) => v === "" || normalizeBrPhone(v) !== null, PHONE_ERROR),
  received_now: z.boolean().default(false),
});

export type QuoteInput = z.input<typeof quoteSchema>;
export type SiteOrderInput = z.input<typeof siteOrderSchema>;
export type PdvOrderInput = z.input<typeof pdvOrderSchema>;

export const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Confira os dados do pedido";
