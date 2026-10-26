/** Formato das linhas do banco (supabase/migrations). */
export type Role = "owner" | "manager" | "cashier" | "attendant" | "waiter" | "kitchen" | "driver";
export type OrderStatus = "novo" | "confirmado" | "preparo" | "pronto" | "saiu" | "entregue" | "cancelado";
export type Fulfillment = "entrega" | "retirada";
export type Channel = "site" | "balcao" | "telefone" | "whatsapp" | "mesa";
export type PaymentMethod = "pix" | "cartao" | "dinheiro";
export type PaymentStatus = "pendente" | "recebido" | "estornado";
export type HalfPricing = "mais_caro" | "media";
export type DeliveryMode = "fixa" | "bairro";
/** Como o entregador ganha por entrega: a taxa do pedido, um valor fixo ou os dois somados. */
export type CourierPay = "taxa" | "fixo" | "taxa_mais_fixo";

export type Pizzeria = {
  id: string;
  slug: string;
  name: string;
  description: string;
  phone: string | null;
  address: string | null;
  accepting_orders: boolean;
  allow_delivery: boolean;
  allow_pickup: boolean;
  min_order_cents: number;
  prep_minutes: number;
  /** Taxa de serviço padrão das mesas (%). */
  service_fee_pct: number;
  /** QR Code das mesas: cliente pode pedir pelo celular; e se o pedido de mesa já aberta vai direto para a cozinha. */
  qr_ordering?: boolean;
  qr_auto_confirm?: boolean;
  /** Aceita Pix pago na hora pelo site (pagamento online). */
  online_pix?: boolean;
  half_pricing: HalfPricing;
  delivery_mode: DeliveryMode;
  delivery_fee_cents: number;
  delivery_eta_min: number;
  delivery_eta_max: number;
  opening_hours: unknown;
  couriers_self_assign: boolean;
  require_delivery_code: boolean;
  courier_pay_mode: CourierPay;
  courier_pay_fixed_cents: number;
  lat: number | null;
  lng: number | null;
  created_at: string;
  updated_at: string;
};

export type Category = { id: string; pizzeria_id: string; name: string; sort: number; active: boolean };
export type Size = { id: string; pizzeria_id: string; name: string; description: string; max_flavors: number; sort: number; active: boolean };
export type Product = {
  id: string;
  pizzeria_id: string;
  category_id: string;
  name: string;
  description: string;
  image_url: string | null;
  is_pizza: boolean;
  price_cents: number;
  available: boolean;
  featured: boolean;
  archived: boolean;
  sort: number;
};
export type ProductPrice = { pizzeria_id: string; product_id: string; size_id: string; price_cents: number };
export type Extra = { id: string; pizzeria_id: string; name: string; price_cents: number; pizza_only: boolean; available: boolean; sort: number };
export type DeliveryZone = {
  id: string;
  pizzeria_id: string;
  name: string;
  neighborhoods: string[];
  fee_cents: number;
  eta_min: number | null;
  eta_max: number | null;
  active: boolean;
};
export type Coupon = {
  id: string;
  pizzeria_id: string;
  code: string;
  discount_type: "percentual" | "valor";
  value: number;
  min_order_cents: number;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  uses: number;
  active: boolean;
  show_in_store: boolean;
  description: string;
  /** Só vale na primeira compra do cliente (conferido pelo telefone). */
  first_order_only?: boolean;
  /** Cupom pessoal (fidelidade, cashback, aniversário): só o dono usa. */
  customer_id?: string | null;
  origin?: "manual" | "fidelidade" | "cashback" | "aniversario";
};

/** Cupom em destaque na loja (o que o visitante pode ver). */
export type StoreCoupon = Pick<Coupon, "code" | "discount_type" | "value" | "min_order_cents" | "ends_at" | "description">;

export type Address = { street: string; number: string; complement: string; neighborhood: string; reference: string };

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  size_id: string | null;
  name: string;
  size_name: string | null;
  flavors: { product_id: string; name: string; fraction: number }[];
  extras: { id: string; name: string; price_cents: number }[];
  note: string | null;
  qty: number;
  unit_price_cents: number;
  subtotal_cents: number;
};

export type Order = {
  id: string;
  pizzeria_id: string;
  number: number;
  public_token: string;
  channel: Channel;
  status: OrderStatus;
  fulfillment: Fulfillment;
  customer_name: string;
  customer_phone: string;
  address: Address | null;
  zone_name: string | null;
  subtotal_cents: number;
  discount_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  coupon_code: string | null;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  change_for_cents: number | null;
  notes: string | null;
  eta_min: number | null;
  eta_max: number | null;
  courier_id: string | null;
  /** Conta da mesa (rodada do salão). */
  tab_id?: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  courier_pay_cents: number | null;
  courier_cash_cents: number;
  settled_at: string | null;
  dest_lat: number | null;
  dest_lng: number | null;
  geo_status: "ok" | "aproximado" | "falhou" | null;
  created_at: string;
  updated_at: string;
};

export type Courier = {
  id: string;
  pizzeria_id: string;
  name: string;
  phone: string | null;
  active: boolean;
  created_at: string;
  user_id: string | null;
  /** Vazio = segue o combinado padrão da loja. */
  pay_mode: CourierPay | null;
  pay_fixed_cents: number | null;
  /** Última posição enviada pelo celular (só enquanto há entrega em rota). */
  last_lat: number | null;
  last_lng: number | null;
  last_seen_at: string | null;
  /** Em turno: compartilha a localização mesmo sem entrega em rota. */
  on_duty: boolean;
  on_duty_since: string | null;
};

export type Menu = {
  pizzeria: Pizzeria;
  categories: Category[];
  sizes: Size[];
  products: Product[];
  prices: ProductPrice[];
  extras: Extra[];
  zones: DeliveryZone[];
};
