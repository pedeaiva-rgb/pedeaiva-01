// Testes do banco: aplica as migrações num Postgres embutido (PGlite) e confere segurança e regras de pedido.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const root = join(__dirname, "..");
let db: PGlite;

type Who = { role: "anon" | "authenticated" | "service_role"; uid?: string };
const OWNER_A = "00000000-0000-4000-8000-00000000000a";
const OWNER_B = "00000000-0000-4000-8000-00000000000b";
const CASHIER_A = "00000000-0000-4000-8000-0000000000ca";
const KITCHEN_A = "00000000-0000-4000-8000-00000000004a";
const ANON: Who = { role: "anon" };
const SERVICE: Who = { role: "service_role" };
const user = (uid: string): Who => ({ role: "authenticated", uid });

async function as<T>(who: Who, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [who.uid ?? ""]);
    await tx.exec(`set local role ${who.role}`);
    return fn(tx);
  });
}
async function one<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = []): Promise<T> {
  return as(who, async (tx) => (await tx.query<T>(sql, params)).rows[0]!);
}
async function rows<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = []): Promise<T[]> {
  return as(who, async (tx) => (await tx.query<T>(sql, params)).rows);
}
async function fails(who: Who, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await as(who, (tx) => tx.query(sql, params));
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`Era para falhar: ${sql}`);
}

let pzA = "";
let pzB = "";
let catA = "";
let productA = "";

const orderPayload = (over: Record<string, unknown> = {}) => ({
  pizzeria_id: pzA,
  idempotency_key: `teste-${Math.random().toString(36).slice(2)}-xxxxxxxx`,
  channel: "site",
  fulfillment: "retirada",
  customer_name: "Maria Silva",
  customer_phone: "(71) 99999-0001",
  subtotal_cents: 5000,
  discount_cents: 0,
  delivery_fee_cents: 0,
  total_cents: 5000,
  payment_method: "pix",
  items: [{ product_id: productA, name: "Calabresa", qty: 1, unit_price_cents: 5000, subtotal_cents: 5000 }],
  ...over,
});
const createOrder = (p: Record<string, unknown>) =>
  one<{ order_id: string; public_token: string; number: number; created: boolean }>(SERVICE, "select * from public.create_order($1)", [p]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));
  for (const f of readdirSync(join(root, "migrations")).sort()) {
    await db.exec(readFileSync(join(root, "migrations", f), "utf8"));
  }
  await db.query("insert into auth.users (id, email) values ($1,'a@x.com'),($2,'b@x.com'),($3,'caixa@x.com'),($4,'cozinha@x.com')", [
    OWNER_A,
    OWNER_B,
    CASHIER_A,
    KITCHEN_A,
  ]);
  pzA = (await one<{ id: string }>(user(OWNER_A), "select public.create_pizzeria('Pizzaria A', 'pizzaria-a') as id")).id;
  pzB = (await one<{ id: string }>(user(OWNER_B), "select public.create_pizzeria('Pizzaria B', 'pizzaria-b') as id")).id;
  await as(user(OWNER_A), async (tx) => {
    await tx.query("select public.add_member_by_email($1, 'caixa@x.com', 'cashier')", [pzA]);
    await tx.query("select public.add_member_by_email($1, 'cozinha@x.com', 'kitchen')", [pzA]);
  });
  catA = (await one<{ id: string }>(user(OWNER_A), "select id from public.categories where pizzeria_id = $1 and name = 'Pizzas'", [pzA])).id;
  productA = (
    await one<{ id: string }>(user(OWNER_A), "insert into public.products (pizzeria_id, category_id, name, is_pizza) values ($1, $2, 'Calabresa', true) returning id", [
      pzA,
      catA,
    ])
  ).id;
}, 60_000);

describe("criação de pizzaria", () => {
  it("já nasce com categorias e tamanhos", async () => {
    const r = await one<{ c: number; s: number }>(
      user(OWNER_A),
      "select (select count(*)::int from public.categories where pizzeria_id = $1) c, (select count(*)::int from public.sizes where pizzeria_id = $1) s",
      [pzA],
    );
    expect(r).toEqual({ c: 3, s: 4 });
  });
  it("recusa endereço reservado e repetido", async () => {
    expect(await fails(user(OWNER_B), "select public.create_pizzeria('X', 'painel')")).toMatch(/reservado/);
    expect(await fails(user(OWNER_B), "select public.create_pizzeria('Xis', 'pizzaria-a')")).toMatch(/já está em uso/);
  });
  it("visitante não cria pizzaria", async () => {
    expect(await fails(ANON, "select public.create_pizzeria('X', 'nova-loja')")).toMatch(/permission denied/);
  });
});

describe("isolamento entre pizzarias", () => {
  it("dono de outra pizzaria não edita o cardápio", async () => {
    const r = await rows(user(OWNER_B), "update public.products set name = 'Hackeada' where id = $1 returning id", [productA]);
    expect(r).toHaveLength(0);
    expect(await fails(user(OWNER_B), "insert into public.products (pizzeria_id, category_id, name) values ($1, $2, 'Intrusa')", [pzA, catA])).toMatch(
      /row-level security/,
    );
  });
  it("visitante lê a vitrine mas não pedidos, clientes, cupons nem contador", async () => {
    expect(await rows(ANON, "select id from public.products where pizzeria_id = $1", [pzA])).toHaveLength(1);
    expect(await fails(ANON, "select * from public.orders")).toMatch(/permission denied/);
    expect(await fails(ANON, "select * from public.customers")).toMatch(/permission denied/);
    expect(await fails(ANON, "select * from public.coupons")).toMatch(/permission denied/);
    expect(await fails(user(OWNER_A), "select * from public.pizzeria_counters")).toMatch(/permission denied/);
    expect(await fails(ANON, "update public.products set name = 'x'")).toMatch(/permission denied/);
  });
  it("ninguém além do servidor cria pedido direto", async () => {
    expect(await fails(ANON, "select * from public.create_order($1)", [orderPayload()])).toMatch(/permission denied/);
    expect(await fails(user(OWNER_A), "select * from public.create_order($1)", [orderPayload()])).toMatch(/permission denied/);
    expect(await fails(user(OWNER_A), "insert into public.orders (pizzeria_id) values ($1)", [pzA])).toMatch(/permission denied/);
  });
  it("o endereço da loja não muda pelo painel", async () => {
    expect(await fails(user(OWNER_A), "update public.pizzerias set slug = 'outra' where id = $1", [pzA])).toMatch(/permission denied/);
    const r = await rows(user(OWNER_A), "update public.pizzerias set name = 'Pizzaria A+' where id = $1 returning name", [pzA]);
    expect(r).toEqual([{ name: "Pizzaria A+" }]);
  });
});

describe("pedidos", () => {
  it("cria com número sequencial e é idempotente", async () => {
    const p = orderPayload();
    const a = await createOrder(p);
    const again = await createOrder(p);
    expect(a.created).toBe(true);
    expect(again).toMatchObject({ order_id: a.order_id, created: false });
    const b = await createOrder(orderPayload({ customer_phone: "71 99999-0002" }));
    expect(b.number).toBe(a.number + 1);
  });
  it("cadastra o cliente pelo telefone normalizado e não troca o nome", async () => {
    await createOrder(orderPayload({ customer_phone: "+55 71 98888-0001", customer_name: "João" }));
    await createOrder(orderPayload({ customer_phone: "(71) 98888-0001", customer_name: "Outro nome" }));
    const c = await rows(user(OWNER_A), "select name, phone from public.customers where pizzeria_id = $1 and phone = '71988880001'", [pzA]);
    expect(c).toEqual([{ name: "João", phone: "71988880001" }]);
  });
  it("recusa telefone inválido e exige telefone na loja online", async () => {
    expect(await fails(SERVICE, "select * from public.create_order($1)", [orderPayload({ customer_phone: "1234" })])).toMatch(/Telefone inválido/);
    expect(await fails(SERVICE, "select * from public.create_order($1)", [orderPayload({ customer_phone: "" })])).toMatch(/Informe o telefone/);
    const pdv = await createOrder(orderPayload({ channel: "balcao", customer_phone: "", customer_name: "Cliente balcão" }));
    expect(pdv.created).toBe(true);
  });
  it("freia muitos pedidos seguidos do mesmo telefone na loja online", async () => {
    const phone = "71977770001";
    for (let i = 0; i < 4; i++) await createOrder(orderPayload({ customer_phone: phone }));
    expect(await fails(SERVICE, "select * from public.create_order($1)", [orderPayload({ customer_phone: phone })])).toMatch(/Muitos pedidos/);
    expect((await createOrder(orderPayload({ customer_phone: phone, channel: "telefone" }))).created).toBe(true);
  });
  it("cupom conta usos e respeita o limite", async () => {
    const cup = (
      await one<{ id: string }>(
        user(OWNER_A),
        "insert into public.coupons (pizzeria_id, code, discount_type, value, max_uses) values ($1, 'BEMVINDO', 'percentual', 10, 1) returning id",
        [pzA],
      )
    ).id;
    await createOrder(orderPayload({ coupon_id: cup, coupon_code: "BEMVINDO", customer_phone: "71966660001" }));
    expect(await fails(SERVICE, "select * from public.create_order($1)", [orderPayload({ coupon_id: cup, customer_phone: "71966660002" })])).toMatch(/Cupom/);
    expect(await fails(user(OWNER_A), "update public.coupons set uses = 0 where id = $1", [cup])).toMatch(/permission denied/);
  });
  it("acompanhamento público não mostra telefone nem endereço", async () => {
    const o = await createOrder(orderPayload({ fulfillment: "entrega", address: { street: "Rua A", number: "1" }, customer_phone: "71955550001" }));
    const t = await one<{ j: Record<string, unknown> }>(ANON, "select public.get_order_tracking($1) j", [o.public_token]);
    const text = JSON.stringify(t.j);
    expect(t.j.number).toBe(o.number);
    expect(text).not.toMatch(/Rua A|71955550001|Maria/);
  });
});

describe("promoções na loja", () => {
  it("visitante vê só cupons marcados para a loja, ativos e no prazo", async () => {
    await as(user(OWNER_A), async (tx) => {
      await tx.query(
        "insert into public.coupons (pizzeria_id, code, discount_type, value, show_in_store, description) values ($1, 'VITRINE10', 'percentual', 10, true, 'Na primeira compra')",
        [pzA],
      );
      await tx.query("insert into public.coupons (pizzeria_id, code, discount_type, value, show_in_store) values ($1, 'SEGREDO', 'percentual', 50, false)", [pzA]);
      await tx.query("insert into public.coupons (pizzeria_id, code, discount_type, value, show_in_store, active) values ($1, 'PAUSADO', 'percentual', 5, true, false)", [pzA]);
      await tx.query(
        "insert into public.coupons (pizzeria_id, code, discount_type, value, show_in_store, ends_at) values ($1, 'VENCIDO', 'percentual', 5, true, now() - interval '1 day')",
        [pzA],
      );
    });
    const list = await rows<{ code: string; description: string }>(ANON, "select * from public.store_coupons('pizzaria-a')");
    expect(list.map((c) => c.code)).toEqual(["VITRINE10"]);
    expect(list[0]!.description).toBe("Na primeira compra");
    expect(Object.keys(list[0]!)).not.toContain("uses");
    expect(await rows(ANON, "select * from public.store_coupons('pizzaria-b')")).toHaveLength(0);
  });
  it("gerência liga e desliga o destaque, sem mexer no contador de usos", async () => {
    const r = await rows(user(OWNER_A), "update public.coupons set show_in_store = false, description = 'x' where pizzeria_id = $1 and code = 'VITRINE10' returning code", [pzA]);
    expect(r).toHaveLength(1);
    expect(await fails(user(OWNER_A), "update public.coupons set uses = 0 where pizzeria_id = $1", [pzA])).toMatch(/permission denied/);
  });
});

describe("status e pagamento", () => {
  it("segue a ordem permitida, com permissão por função", async () => {
    const o = await createOrder(orderPayload({ customer_phone: "71944440001" }));
    const go = (who: Who, to: string, note: string | null = null) =>
      one<{ s: string }>(who, "select public.transition_order($1, $2::public.order_status, $3) s", [o.order_id, to, note]);
    expect(await fails(user(KITCHEN_A), "select public.transition_order($1, 'confirmado')", [o.order_id])).toMatch(/Sem permissão/);
    expect(await fails(user(OWNER_B), "select public.transition_order($1, 'confirmado')", [o.order_id])).toMatch(/Sem permissão/);
    expect(await fails(user(CASHIER_A), "select public.transition_order($1, 'pronto')", [o.order_id])).toMatch(/Não é possível/);
    expect((await go(user(CASHIER_A), "confirmado")).s).toBe("confirmado");
    expect((await go(user(KITCHEN_A), "preparo")).s).toBe("preparo");
    expect((await go(user(KITCHEN_A), "pronto")).s).toBe("pronto");
    expect((await go(user(CASHIER_A), "entregue")).s).toBe("entregue");
    expect(await fails(user(OWNER_A), "select public.transition_order($1, 'cancelado', 'motivo')", [o.order_id])).toMatch(/Não é possível/);
    const ev = await rows(user(OWNER_A), "select to_status from public.order_events where order_id = $1 order by created_at", [o.order_id]);
    expect(ev.map((e) => e.to_status)).toEqual(["novo", "confirmado", "preparo", "pronto", "entregue"]);
  });
  it("cancelar exige motivo", async () => {
    const o = await createOrder(orderPayload({ customer_phone: "71944440002" }));
    expect(await fails(user(CASHIER_A), "select public.transition_order($1, 'cancelado')", [o.order_id])).toMatch(/motivo/);
    await one(user(OWNER_A), "select public.transition_order($1, 'cancelado', 'Cliente desistiu')", [o.order_id]);
    expect(await fails(user(CASHIER_A), "select public.register_payment($1, 'pix')", [o.order_id])).toMatch(/cancelado/);
  });
  it("um recebimento por pedido; estorno só pela gerência e com motivo", async () => {
    const o = await createOrder(orderPayload({ customer_phone: "71944440003" }));
    await one(user(CASHIER_A), "select public.register_payment($1, 'dinheiro')", [o.order_id]);
    expect(await fails(user(CASHIER_A), "select public.register_payment($1, 'pix')", [o.order_id])).toMatch(/já tem recebimento/);
    expect(await fails(user(CASHIER_A), "select public.refund_payment($1, 'Erro no valor')", [o.order_id])).toMatch(/PIN do gerente/);
    expect(await fails(user(OWNER_A), "select public.refund_payment($1, '')", [o.order_id])).toMatch(/motivo/);
    await one(user(OWNER_A), "select public.refund_payment($1, 'Erro no valor')", [o.order_id]);
    const p = await rows(user(OWNER_A), "select kind, method, amount_cents from public.payments where order_id = $1 order by created_at", [o.order_id]);
    expect(p).toEqual([
      { kind: "recebimento", method: "dinheiro", amount_cents: 5000 },
      { kind: "estorno", method: "dinheiro", amount_cents: 5000 },
    ]);
    expect(await fails(user(OWNER_A), "update public.payments set amount_cents = 1")).toMatch(/permission denied/);
  });
  it("outra pizzaria não vê pedidos nem pagamentos", async () => {
    expect(await rows(user(OWNER_B), "select id from public.orders")).toHaveLength(0);
    expect(await rows(user(OWNER_B), "select id from public.payments")).toHaveLength(0);
    expect(await rows(user(OWNER_B), "select id from public.customers")).toHaveLength(0);
  });
});

describe("equipe e fotos", () => {
  it("a loja não fica sem proprietário", async () => {
    expect(await fails(SERVICE, "delete from public.members where pizzeria_id = $1 and user_id = $2", [pzA, OWNER_A])).toMatch(/proprietário/);
  });
  it("só o dono adiciona pessoas", async () => {
    expect(await fails(user(CASHIER_A), "select public.add_member_by_email($1, 'b@x.com', 'cashier')", [pzA])).toMatch(/Sem permissão/);
  });
  it("foto só entra na pasta da própria pizzaria", async () => {
    await one(user(OWNER_A), "insert into storage.objects (bucket_id, name) values ('product-images', $1)", [`${pzA}/foto.webp`]);
    expect(await fails(user(OWNER_A), "insert into storage.objects (bucket_id, name) values ('product-images', $1)", [`${pzB}/foto.webp`])).toMatch(
      /row-level security/,
    );
    expect(await fails(user(CASHIER_A), "insert into storage.objects (bucket_id, name) values ('product-images', $1)", [`${pzA}/x.webp`])).toMatch(
      /row-level security/,
    );
  });
});

describe("entregas", () => {
  it("atribui entregador, registra saída e entrega, e bloqueia entregador de outra loja", async () => {
    const courier = (await one<{ id: string }>(user(OWNER_A), "insert into public.couriers (pizzeria_id, name, phone) values ($1, 'Carlos', '71988887777') returning id", [pzA])).id;
    const other = (await one<{ id: string }>(user(OWNER_B), "insert into public.couriers (pizzeria_id, name) values ($1, 'Intruso') returning id", [pzB])).id;
    const o = await createOrder(orderPayload({ fulfillment: "entrega", address: { street: "Rua B", number: "2", neighborhood: "Centro" }, customer_phone: "71933330001" }));
    expect(await fails(user(KITCHEN_A), "select public.assign_courier($1, $2)", [o.order_id, courier])).toMatch(/Sem permissão/);
    expect(await fails(user(CASHIER_A), "select public.assign_courier($1, $2)", [o.order_id, other])).toMatch(/não encontrado/);
    await one(user(CASHIER_A), "select public.assign_courier($1, $2)", [o.order_id, courier]);
    for (const s of ["confirmado", "preparo", "pronto", "saiu", "entregue"]) await one(user(OWNER_A), "select public.transition_order($1, $2::public.order_status)", [o.order_id, s]);
    const r = await one<{ courier_id: string; dispatched: boolean; delivered: boolean }>(
      user(OWNER_A),
      "select courier_id, dispatched_at is not null dispatched, delivered_at is not null delivered from public.orders where id = $1",
      [o.order_id],
    );
    expect(r).toEqual({ courier_id: courier, dispatched: true, delivered: true });
    expect(await fails(user(OWNER_A), "select public.assign_courier($1, null)", [o.order_id])).toMatch(/finalizado/);
  });
  it("pedido de retirada não recebe entregador; entregador desativado também não", async () => {
    const off = (await one<{ id: string }>(user(OWNER_A), "insert into public.couriers (pizzeria_id, name, active) values ($1, 'Folga', false) returning id", [pzA])).id;
    const pickup = await createOrder(orderPayload({ customer_phone: "71933330002" }));
    expect(await fails(user(OWNER_A), "select public.assign_courier($1, $2)", [pickup.order_id, off])).toMatch(/retirada/);
    const del = await createOrder(orderPayload({ fulfillment: "entrega", address: { street: "Rua C", number: "3", neighborhood: "Centro" }, customer_phone: "71933330003" }));
    expect(await fails(user(OWNER_A), "select public.assign_courier($1, $2)", [del.order_id, off])).toMatch(/desativado/);
  });
});

describe("avisos para o n8n", () => {
  const calls = () => rows<{ url: string; body: { evento: string; pedido: Record<string, unknown>; cliente: Record<string, unknown> }; headers: Record<string, string> }>(SERVICE, "select url, body, headers from net.calls order by id");
  it("desligado não envia nada", async () => {
    await one(user(OWNER_A), "insert into public.pizzeria_webhooks (pizzeria_id, url, site_url, active) values ($1, 'https://n8n.exemplo.com/webhook/x', 'https://loja.exemplo.com/', false) returning pizzeria_id", [pzA]);
    const before = (await calls()).length;
    await createOrder(orderPayload({ customer_phone: "71922220001" }));
    expect((await calls()).length).toBe(before);
  });
  it("ligado envia pedido criado e mudança de status, com segredo e sem endereço", async () => {
    await one(user(OWNER_A), "update public.pizzeria_webhooks set active = true where pizzeria_id = $1 returning pizzeria_id", [pzA]);
    const before = (await calls()).length;
    const o = await createOrder(orderPayload({ fulfillment: "entrega", address: { street: "Rua Secreta", number: "9", neighborhood: "Centro" }, customer_phone: "71922220002", customer_name: "Ana" }));
    await one(user(CASHIER_A), "select public.transition_order($1, 'confirmado')", [o.order_id]);
    const sent = (await calls()).slice(before);
    expect(sent.map((c) => c.body.evento)).toEqual(["pedido.criado", "pedido.status"]);
    expect(sent[1]!.body.pedido.status).toBe("confirmado");
    expect(sent[1]!.body.pedido.status_anterior).toBe("novo");
    expect(sent[0]!.body.cliente).toEqual({ nome: "Ana", telefone: "71922220002", whatsapp: "5571922220002" });
    expect(sent[0]!.body.pedido.link_acompanhamento).toBe(`https://loja.exemplo.com/pedido/${o.public_token}`);
    expect(sent[0]!.headers["X-Pede-Ai-Segredo"]).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(sent)).not.toMatch(/Rua Secreta/);
  });
  it("outra pizzaria não lê nem altera a configuração", async () => {
    expect(await rows(user(OWNER_B), "select * from public.pizzeria_webhooks")).toHaveLength(0);
    expect(await rows(user(OWNER_B), "update public.pizzeria_webhooks set url = 'https://mal.com' returning pizzeria_id")).toHaveLength(0);
    expect(await rows(user(CASHIER_A), "select * from public.pizzeria_webhooks")).toHaveLength(0);
  });
});

describe("equipe por link de convite", () => {
  const MOTO = "00000000-0000-4000-8000-0000000000d1";
  const ATEND = "00000000-0000-4000-8000-0000000000d2";
  const CPF = "52998224725";
  let code = "";
  beforeAll(async () => {
    await db.query("insert into auth.users (id, email) values ($1, 'moto@x.com'), ($2, 'atende@x.com')", [MOTO, ATEND]);
  });

  it("só o dono vê e troca o link", async () => {
    code = (await one<{ code: string }>(user(OWNER_A), "select * from public.team_invite($1)", [pzA])).code;
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    expect(await fails(user(CASHIER_A), "select * from public.team_invite($1)", [pzA])).toMatch(/Sem permissão/);
    expect(await fails(user(OWNER_B), "select public.reset_team_invite($1)", [pzA])).toMatch(/Sem permissão/);
    expect(await rows(ANON, "select * from public.invite_info($1)", [code])).toEqual([{ pizzeria_name: expect.stringMatching(/^Pizzaria A/), pizzeria_slug: "pizzaria-a" }]);
    const novo = (await one<{ c: string }>(user(OWNER_A), "select public.reset_team_invite($1) c", [pzA])).c;
    expect(await rows(ANON, "select * from public.invite_info($1)", [code])).toHaveLength(0);
    code = novo;
  });

  it("pedido de acesso confere CPF e telefone e só o dono vê", async () => {
    expect(await fails(user(MOTO), "select public.request_join($1, 'João Moto', '11111111111', '71988887777')", [code])).toMatch(/CPF inválido/);
    expect(await fails(user(MOTO), "select public.request_join($1, 'João Moto', $2, '123')", [code, CPF])).toMatch(/Telefone/);
    expect(await fails(ANON, "select public.request_join($1, 'João Moto', $2, '71988887777')", [code, CPF])).toMatch(/permission denied/);
    expect(await fails(user(MOTO), "select public.request_join('naoexiste', 'João Moto', $1, '71988887777')", [CPF])).toMatch(/não vale mais/);
    const r = await one<{ n: string }>(user(MOTO), "select public.request_join($1, 'João Moto', '529.982.247-25', '(71) 98888-7777') n", [code]);
    expect(r.n).toMatch(/^Pizzaria A/);
    expect(await rows(user(OWNER_A), "select full_name, email, cpf, phone, status from public.join_requests where user_id = $1", [MOTO])).toEqual([
      { full_name: "João Moto", email: "moto@x.com", cpf: CPF, phone: "71988887777", status: "pendente" },
    ]);
    expect(await rows(user(MOTO), "select id from public.join_requests")).toHaveLength(1);
    expect(await rows(user(CASHIER_A), "select id from public.join_requests")).toHaveLength(0);
    expect(await rows(user(OWNER_B), "select id from public.join_requests")).toHaveLength(0);
    expect(await fails(user(MOTO), "update public.join_requests set status = 'aprovado'")).toMatch(/permission denied/);
  });

  it("aprovar como entregador cria o acesso e o cadastro de entregador", async () => {
    const req = (await one<{ id: string }>(user(OWNER_A), "select id from public.join_requests where user_id = $1", [MOTO])).id;
    expect(await fails(user(CASHIER_A), "select public.approve_join($1, 'driver')", [req])).toMatch(/Sem permissão/);
    expect(await fails(user(OWNER_A), "select public.approve_join($1, 'owner')", [req])).toMatch(/função da equipe/);
    await one(user(OWNER_A), "select public.approve_join($1, 'driver')", [req]);
    expect(await one(user(OWNER_A), "select role, display_name from public.members where pizzeria_id = $1 and user_id = $2", [pzA, MOTO])).toEqual({
      role: "driver",
      display_name: "João Moto",
    });
    expect(await one(user(OWNER_A), "select name, phone, active from public.couriers where user_id = $1", [MOTO])).toEqual({ name: "João Moto", phone: "71988887777", active: true });
    expect(await fails(user(OWNER_A), "select public.approve_join($1, 'kitchen')", [req])).toMatch(/já foi respondido/);
    expect(await fails(user(MOTO), "select public.request_join($1, 'João Moto', $2, '71988887777')", [code, CPF])).toMatch(/já faz parte/);
  });

  it("deixar de ser entregador desativa o cadastro de entregador", async () => {
    await one(user(OWNER_A), "update public.members set role = 'kitchen' where pizzeria_id = $1 and user_id = $2 returning user_id", [pzA, MOTO]);
    expect((await one<{ active: boolean }>(user(OWNER_A), "select active from public.couriers where user_id = $1", [MOTO])).active).toBe(false);
    await one(user(OWNER_A), "update public.members set role = 'driver' where pizzeria_id = $1 and user_id = $2 returning user_id", [pzA, MOTO]);
    expect(await rows(user(OWNER_A), "select active from public.couriers where user_id = $1", [MOTO])).toEqual([{ active: true }]);
  });

  it("recusado pode pedir de novo; atendente confirma pedido mas não recebe pagamento", async () => {
    await one(user(ATEND), "select public.request_join($1, 'Bia Atende', $2, '71977776666')", [code, CPF]);
    const req = (await one<{ id: string }>(user(OWNER_A), "select id from public.join_requests where user_id = $1", [ATEND])).id;
    await one(user(OWNER_A), "select public.reject_join($1)", [req]);
    expect(await rows(user(ATEND), "select status from public.join_requests")).toEqual([{ status: "recusado" }]);
    await one(user(ATEND), "select public.request_join($1, 'Bia Atende', $2, '71977776666')", [code, CPF]);
    expect(await rows(user(ATEND), "select status from public.join_requests")).toEqual([{ status: "pendente" }]);
    await one(user(OWNER_A), "select public.approve_join($1, 'attendant')", [req]);
    const o = await createOrder(orderPayload());
    await one(user(ATEND), "select public.transition_order($1, 'confirmado')", [o.order_id]);
    expect(await fails(user(ATEND), "select public.register_payment($1, 'pix')", [o.order_id])).toMatch(/Sem permissão/);
  });

  it("link desligado para de aceitar pedidos", async () => {
    await one(user(OWNER_A), "select public.set_team_invite_active($1, false)", [pzA]);
    expect(await rows(ANON, "select * from public.invite_info($1)", [code])).toHaveLength(0);
  });

  it("endereço de loja reservado para o convite", async () => {
    expect(await fails(user(OWNER_B), "select public.create_pizzeria('Convite', 'convite')")).toMatch(/pizzerias_slug_reservado|check/);
  });
});

describe("painel do entregador", () => {
  const D1 = "00000000-0000-4000-8000-0000000000e1";
  const D2 = "00000000-0000-4000-8000-0000000000e2";
  let c1 = "";
  const entrega = (over: Record<string, unknown> = {}) =>
    createOrder(
      orderPayload({
        fulfillment: "entrega",
        address: { street: "Rua A", number: "10", neighborhood: "Centro" },
        channel: "telefone",
        customer_phone: "71933330001",
        delivery_fee_cents: 800,
        total_cents: 5800,
        payment_method: "dinheiro",
        ...over,
      }),
    );
  const ready = async (id: string) => {
    await one(user(OWNER_A), "select public.transition_order($1, 'confirmado')", [id]);
    await one(user(OWNER_A), "select public.transition_order($1, 'pronto')", [id]);
  };
  const seen = async (who: string) => (await rows<{ id: string }>(user(who), "select id from public.orders where pizzeria_id = $1", [pzA])).map((r) => r.id);

  beforeAll(async () => {
    await db.query("insert into auth.users (id, email) values ($1, 'd1@x.com'), ($2, 'd2@x.com')", [D1, D2]);
    await as(user(OWNER_A), async (tx) => {
      await tx.query("select public.add_member_by_email($1, 'd1@x.com', 'driver', 'Davi Um')", [pzA]);
      await tx.query("select public.add_member_by_email($1, 'd2@x.com', 'driver', 'Dora Dois')", [pzA]);
    });
    c1 = (await one<{ id: string }>(user(OWNER_A), "select id from public.couriers where user_id = $1", [D1])).id;
  });

  it("entregador vê só os prontos disponíveis e os dele, sem código nem clientes", async () => {
    const cozinha = await entrega();
    const pronto = await entrega();
    await ready(pronto.order_id);
    const retirada = await createOrder(orderPayload());
    await ready(retirada.order_id);
    const vis = await seen(D1);
    expect(vis).toContain(pronto.order_id);
    expect(vis).not.toContain(cozinha.order_id);
    expect(vis).not.toContain(retirada.order_id);
    expect(await rows(user(D1), "select * from public.delivery_codes")).toHaveLength(0);
    expect(await rows(user(D1), "select * from public.customers")).toHaveLength(0);
    expect(await rows(user(D1), "select name from public.couriers")).toEqual([{ name: "Davi Um" }]);
    expect((await rows(user(OWNER_A), "select * from public.delivery_codes where order_id = $1", [pronto.order_id])).length).toBe(1);
  });

  it("pegar o pedido tira ele da lista dos outros; só o dono do pedido mexe", async () => {
    const o = await entrega();
    await ready(o.order_id);
    await one(user(D1), "select public.take_order($1)", [o.order_id]);
    expect(await fails(user(D2), "select public.take_order($1)", [o.order_id])).toMatch(/Outro entregador/);
    expect(await seen(D2)).not.toContain(o.order_id);
    expect(await fails(user(D2), "select public.transition_order($1, 'saiu')", [o.order_id])).toMatch(/não está com você/);
    await one(user(D1), "select public.release_order($1)", [o.order_id]);
    expect(await seen(D2)).toContain(o.order_id);
  });

  it("entrega com código: guarda o ganho e o dinheiro em mãos", async () => {
    const o = await entrega();
    await ready(o.order_id);
    await one(user(D1), "select public.take_order($1)", [o.order_id]);
    await one(user(D1), "select public.transition_order($1, 'saiu')", [o.order_id]);
    expect(await fails(user(D1), "select public.transition_order($1, 'entregue')", [o.order_id])).toMatch(/código de entrega/);
    expect(await fails(user(D1), "select public.complete_delivery($1, 'xxxx')", [o.order_id])).toMatch(/Código errado/);
    const t = await one<{ t: { courier_name: string; delivery_code: string } }>(ANON, "select public.get_order_tracking($1) t", [o.public_token]);
    expect(t.t.courier_name).toBe("Davi");
    await one(user(D1), "select public.complete_delivery($1, $2)", [o.order_id, t.t.delivery_code]);
    expect(
      await one(user(OWNER_A), "select status, courier_pay_cents, courier_cash_cents, payment_status from public.orders where id = $1", [o.order_id]),
    ).toEqual({ status: "entregue", courier_pay_cents: 800, courier_cash_cents: 5800, payment_status: "recebido" });
    expect((await one<{ n: number }>(user(OWNER_A), "select count(*)::int n from public.payments where order_id = $1", [o.order_id])).n).toBe(1);
  });

  it("combinado do entregador e da loja muda o valor ganho", async () => {
    await one(user(OWNER_A), "update public.couriers set pay_mode = 'fixo', pay_fixed_cents = 500 where id = $1 returning id", [c1]);
    const a = await entrega({ payment_method: "pix" });
    await ready(a.order_id);
    await one(user(OWNER_A), "select public.assign_courier($1, $2)", [a.order_id, c1]);
    await one(user(OWNER_A), "select public.transition_order($1, 'saiu')", [a.order_id]);
    await one(user(OWNER_A), "select public.transition_order($1, 'entregue')", [a.order_id]);
    expect(await one(user(OWNER_A), "select courier_pay_cents, courier_cash_cents, payment_status from public.orders where id = $1", [a.order_id])).toEqual({
      courier_pay_cents: 500,
      courier_cash_cents: 0,
      payment_status: "pendente",
    });
    await one(user(OWNER_A), "update public.couriers set pay_mode = null, pay_fixed_cents = null where id = $1 returning id", [c1]);
    await one(user(OWNER_A), "update public.pizzerias set courier_pay_mode = 'taxa_mais_fixo', courier_pay_fixed_cents = 300 where id = $1 returning id", [pzA]);
    const b = await entrega({ payment_method: "pix" });
    await ready(b.order_id);
    await one(user(D1), "select public.take_order($1)", [b.order_id]);
    await one(user(D1), "select public.transition_order($1, 'saiu')", [b.order_id]);
    await one(user(OWNER_A), "update public.pizzerias set require_delivery_code = false where id = $1 returning id", [pzA]);
    await one(user(D1), "select public.transition_order($1, 'entregue')", [b.order_id]);
    expect((await one<{ p: number }>(user(OWNER_A), "select courier_pay_cents p from public.orders where id = $1", [b.order_id])).p).toBe(1100);
  });

  it("sem autoatribuição, entregador não vê nem pega pedido livre", async () => {
    await one(user(OWNER_A), "update public.pizzerias set couriers_self_assign = false where id = $1 returning id", [pzA]);
    const o = await entrega();
    await ready(o.order_id);
    expect(await seen(D1)).not.toContain(o.order_id);
    expect(await fails(user(D1), "select public.take_order($1)", [o.order_id])).toMatch(/atendimento/);
    await one(user(OWNER_A), "update public.pizzerias set couriers_self_assign = true where id = $1 returning id", [pzA]);
  });

  it("acerto: só a gerência fecha, e fecha tudo que estava em aberto", async () => {
    expect(await fails(user(D1), "select public.settle_courier($1)", [c1])).toMatch(/Sem permissão/);
    const n = (await one<{ n: number }>(user(OWNER_A), "select public.settle_courier($1) n", [c1])).n;
    expect(n).toBe(3);
    expect((await one<{ n: number }>(user(OWNER_A), "select public.settle_courier($1) n", [c1])).n).toBe(0);
  });
});

describe("mapa das entregas", () => {
  const D3 = "00000000-0000-4000-8000-0000000000e3";
  beforeAll(async () => {
    await db.query("insert into auth.users (id, email) values ($1, 'd3@x.com')", [D3]);
    await one(user(OWNER_A), "select public.add_member_by_email($1, 'd3@x.com', 'driver', 'Tito Três')", [pzA]);
  });
  const where = () => one<{ last_lat: number | null; last_lng: number | null }>(user(OWNER_A), "select last_lat, last_lng from public.couriers where user_id = $1", [D3]);

  it("posição só é guardada com entrega em rota e some ao entregar", async () => {
    const loc = "select public.update_courier_location($1, -12.97, -38.5, 15) ok";
    expect(await fails(user(KITCHEN_A), loc, [pzA])).toMatch(/Sem permissão/);
    expect((await one<{ ok: boolean }>(user(D3), loc, [pzA])).ok).toBe(false);
    expect((await where()).last_lat).toBeNull();

    const o = await createOrder(
      orderPayload({ channel: "telefone", fulfillment: "entrega", address: { street: "Rua B", number: "2", neighborhood: "Barra" }, customer_phone: "71944440001", delivery_fee_cents: 500, total_cents: 5500 }),
    );
    await one(user(OWNER_A), "select public.transition_order($1, 'confirmado')", [o.order_id]);
    await one(user(OWNER_A), "select public.transition_order($1, 'pronto')", [o.order_id]);
    await one(user(D3), "select public.take_order($1)", [o.order_id]);
    await one(user(D3), "select public.transition_order($1, 'saiu')", [o.order_id]);
    await db.query("update public.orders set dest_lat = -13.0, dest_lng = -38.52, geo_status = 'ok' where id = $1", [o.order_id]);
    expect((await one<{ ok: boolean }>(user(D3), loc, [pzA])).ok).toBe(true);
    expect(await where()).toEqual({ last_lat: -12.97, last_lng: -38.5 });

    const t = await one<{ t: { map: { dest: { lat: number }; courier: { lat: number } } } }>(ANON, "select public.get_order_tracking($1) t", [o.public_token]);
    expect(t.t.map.dest.lat).toBe(-13);
    expect(t.t.map.courier.lat).toBe(-12.97);

    await one(user(OWNER_A), "update public.pizzerias set require_delivery_code = false where id = $1 returning id", [pzA]);
    await one(user(D3), "select public.transition_order($1, 'entregue')", [o.order_id]);
    expect(await where()).toEqual({ last_lat: null, last_lng: null });
    const after = await one<{ t: { map: unknown } }>(ANON, "select public.get_order_tracking($1) t", [o.public_token]);
    expect(after.t.map).toBeNull();
  });

  it("outros não mudam a posição nem as coordenadas", async () => {
    expect(await rows(user(D3), "update public.couriers set last_lat = 1 where user_id = $1 returning id", [D3])).toHaveLength(0);
    expect(await fails(user(OWNER_B), "select public.update_courier_location($1, 1, 1)", [pzA])).toMatch(/Sem permissão/);
  });
});

describe("entregador em serviço", () => {
  const D4 = "00000000-0000-4000-8000-0000000000e4";
  const loc = "select public.update_courier_location($1, -12.9, -38.4, 10) ok";
  const me = () => one<{ on_duty: boolean; last_lat: number | null }>(user(OWNER_A), "select on_duty, last_lat from public.couriers where user_id = $1", [D4]);
  beforeAll(async () => {
    await db.query("insert into auth.users (id, email) values ($1, 'd4@x.com')", [D4]);
    await one(user(OWNER_A), "select public.add_member_by_email($1, 'd4@x.com', 'driver', 'Quatro')", [pzA]);
  });

  it("em turno guarda a posição sem entrega; encerrando, apaga", async () => {
    expect((await one<{ ok: boolean }>(user(D4), loc, [pzA])).ok).toBe(false);
    await one(user(D4), "select public.set_courier_on_duty($1, true)", [pzA]);
    expect((await one<{ ok: boolean }>(user(D4), loc, [pzA])).ok).toBe(true);
    expect(await me()).toEqual({ on_duty: true, last_lat: -12.9 });
    await one(user(D4), "select public.set_courier_on_duty($1, false)", [pzA]);
    expect(await me()).toEqual({ on_duty: false, last_lat: null });
  });

  it("só o próprio entregador liga o turno; desativado sai do turno", async () => {
    expect(await fails(user(KITCHEN_A), "select public.set_courier_on_duty($1, true)", [pzA])).toMatch(/Sem permissão/);
    await one(user(D4), "select public.set_courier_on_duty($1, true)", [pzA]);
    await one(user(D4), loc, [pzA]);
    await one(user(OWNER_A), "update public.couriers set active = false where user_id = $1 returning id", [D4]);
    expect(await me()).toEqual({ on_duty: false, last_lat: null });
    expect(await fails(user(D4), "select public.set_courier_on_duty($1, true)", [pzA])).toMatch(/desativado/);
    await one(user(OWNER_A), "update public.couriers set active = true where user_id = $1 returning id", [D4]);
  });
});

describe("tela da cozinha por link", () => {
  let code = "";
  const open = (pin: string | null = null) => one<{ r: { token?: string; needs_pin?: boolean; error?: string } }>(ANON, "select public.kitchen_open($1, $2) r", [code, pin]).then((x) => x.r);

  it("só dono e gerente veem e trocam o link", async () => {
    code = (await one<{ code: string }>(user(OWNER_A), "select * from public.kitchen_link($1)", [pzA])).code;
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    expect(await fails(user(KITCHEN_A), "select * from public.kitchen_link($1)", [pzA])).toMatch(/Sem permissão/);
    expect(await fails(ANON, "select * from public.kitchen_links")).toMatch(/permission denied/);
  });

  it("sem PIN o aparelho entra direto e só vê o que vai no forno", async () => {
    const r = await open();
    expect(r.token).toMatch(/^[0-9a-f]{64}$/);
    const o = await createOrder(orderPayload({ channel: "telefone", customer_phone: "71955550001", customer_name: "Cliente Secreto" }));
    await one(user(OWNER_A), "select public.transition_order($1, 'confirmado')", [o.order_id]);
    const t = (await one<{ t: { tickets: { id: string; status: string }[] } }>(ANON, "select public.kitchen_tickets($1) t", [r.token])).t;
    expect(t.tickets.map((x) => x.id)).toContain(o.order_id);
    expect(JSON.stringify(t)).not.toMatch(/Cliente Secreto|71955550001|total/);
    await one(ANON, "select public.kitchen_move($1, $2, 'preparo')", [r.token, o.order_id]);
    expect(await fails(ANON, "select public.kitchen_move($1, $2, 'cancelado')", [r.token, o.order_id])).toMatch(/só marca preparo e pronto/);
    expect(await fails(ANON, "select public.kitchen_move('falso', $1, 'pronto')", [o.order_id])).toMatch(/desconectado/);
    await one(ANON, "select public.kitchen_move($1, $2, 'pronto')", [r.token, o.order_id]);
    expect((await one<{ s: string }>(user(OWNER_A), "select status s from public.orders where id = $1", [o.order_id])).s).toBe("pronto");
  });

  it("com PIN: pede, confere e trava depois de 5 erros", async () => {
    expect(await fails(user(OWNER_A), "select public.set_kitchen_pin($1, '12a4')", [pzA])).toMatch(/4 números/);
    await one(user(OWNER_A), "select public.set_kitchen_pin($1, '4321')", [pzA]);
    expect((await open()).needs_pin).toBe(true);
    expect((await open("1111")).error).toMatch(/PIN errado/);
    expect((await open("4321")).token).toBeTruthy();
    for (let i = 0; i < 5; i++) await open("0000");
    expect((await open("4321")).error).toMatch(/Muitas tentativas/);
    await one(user(OWNER_A), "select public.set_kitchen_pin($1, null)", [pzA]);
    expect((await open()).token).toBeTruthy();
  });

  it("trocar o link derruba os aparelhos e o link antigo", async () => {
    const r = await open();
    const novo = (await one<{ c: string }>(user(OWNER_A), "select public.reset_kitchen_link($1) c", [pzA])).c;
    expect((await open()).error).toMatch(/não vale mais/);
    expect((await one<{ t: { error?: string } }>(ANON, "select public.kitchen_tickets($1) t", [r.token])).t.error).toBe("expirado");
    code = novo;
    expect((await open()).token).toBeTruthy();
  });
});

describe("cozinha: cancelados", () => {
  it("o link mostra o cancelado que já estava na cozinha, com o motivo", async () => {
    const code = (await one<{ code: string }>(user(OWNER_A), "select * from public.kitchen_link($1)", [pzA])).code;
    const dev = (await one<{ r: { token: string } }>(ANON, "select public.kitchen_open($1, null) r", [code])).r.token;
    const naCozinha = await createOrder(orderPayload({ channel: "telefone", customer_phone: "71966660001" }));
    await one(user(OWNER_A), "select public.transition_order($1, 'confirmado')", [naCozinha.order_id]);
    await one(user(OWNER_A), "select public.transition_order($1, 'cancelado', 'cliente desistiu')", [naCozinha.order_id]);
    const nunca = await createOrder(orderPayload({ channel: "telefone", customer_phone: "71966660002" }));
    await one(user(OWNER_A), "select public.transition_order($1, 'cancelado', 'teste')", [nunca.order_id]);
    const t = (await one<{ t: { tickets: { id: string; status: string; cancel: { note: string; from: string } | null }[] } }>(ANON, "select public.kitchen_tickets($1) t", [dev])).t;
    const c = t.tickets.find((x) => x.id === naCozinha.order_id)!;
    expect(c.status).toBe("cancelado");
    expect(c.cancel).toMatchObject({ note: "cliente desistiu", from: "confirmado" });
    expect(t.tickets.some((x) => x.id === nunca.order_id)).toBe(false);
  });
});

describe("modo balcão e autorização do gerente", () => {
  let dev = "";
  const check = (user_id: string, pin: string) =>
    one<{ r: { ok?: boolean; error?: string } }>(SERVICE, "select public.counter_check_pin($1, $2, $3) r", [dev, user_id, pin]).then((x) => x.r);

  it("cada pessoa cria o próprio PIN; PIN óbvio é recusado", async () => {
    expect(await fails(user(CASHIER_A), "select public.set_my_pin($1, '1234')", [pzA])).toMatch(/menos óbvio/);
    expect(await fails(user(CASHIER_A), "select public.set_my_pin($1, '12')", [pzA])).toMatch(/4 números/);
    await one(user(CASHIER_A), "select public.set_my_pin($1, '5821')", [pzA]);
    await one(user(OWNER_A), "select public.set_my_pin($1, '7390')", [pzA]);
    expect((await one<{ s: boolean }>(user(CASHIER_A), "select public.my_pin_status($1) s", [pzA])).s).toBe(true);
    expect(await fails(user(OWNER_B), "select public.set_my_pin($1, '5821')", [pzA])).toMatch(/Sem permissão/);
    expect(await fails(ANON, "select * from public.member_pins")).toMatch(/permission denied/);
  });

  it("balcão lista quem tem PIN (sem cozinha nem entregador) e confere o PIN", async () => {
    const code = (await one<{ code: string }>(user(OWNER_A), "select * from public.counter_link($1)", [pzA])).code;
    dev = (await one<{ r: { token: string } }>(ANON, "select public.counter_open($1) r", [code])).r.token;
    await one(user(KITCHEN_A), "select public.set_my_pin($1, '6655')", [pzA]);
    const staff = (await one<{ s: { staff: { user_id: string; role: string }[] } }>(ANON, "select public.counter_staff($1) s", [dev])).s.staff;
    expect(staff.map((s) => s.user_id).sort()).toEqual([CASHIER_A, OWNER_A].sort());
    expect(await fails(ANON, "select public.counter_check_pin($1, $2, '5821')", [dev, CASHIER_A])).toMatch(/permission denied/);
    expect((await check(CASHIER_A, "0000")).error).toMatch(/PIN errado/);
    expect((await check(CASHIER_A, "5821")).ok).toBe(true);
    expect((await check(KITCHEN_A, "6655")).error).toMatch(/não pode entrar/);
    for (let i = 0; i < 5; i++) await check(CASHIER_A, "0001");
    expect((await check(CASHIER_A, "5821")).error).toMatch(/Muitas tentativas/);
  });

  it("caixa só cancela e estorna com o PIN do gerente; dono cancela direto", async () => {
    const o = await createOrder(orderPayload({ channel: "telefone", customer_phone: "71977770001" }));
    await one(user(CASHIER_A), "select public.transition_order($1, 'confirmado')", [o.order_id]);
    expect(await fails(user(CASHIER_A), "select public.transition_order($1, 'cancelado', 'cliente desistiu')", [o.order_id])).toMatch(/PIN do gerente/);
    expect(await fails(user(CASHIER_A), "select public.request_approval($1, 'cancelar', '5821')", [o.order_id])).toMatch(/PIN de gerente errado/);
    expect((await one<{ n: string }>(user(CASHIER_A), "select public.request_approval($1, 'cancelar', '7390') n", [o.order_id])).n).toBeTruthy();
    await one(user(CASHIER_A), "select public.transition_order($1, 'cancelado', 'cliente desistiu')", [o.order_id]);
    const ev = await one<{ note: string }>(user(OWNER_A), "select note from public.order_events where order_id = $1 and to_status = 'cancelado'", [o.order_id]);
    expect(ev.note).toMatch(/cliente desistiu · autorizado por/);

    const p = await createOrder(orderPayload({ channel: "telefone", customer_phone: "71977770002" }));
    await one(user(CASHIER_A), "select public.register_payment($1, 'pix')", [p.order_id]);
    expect(await fails(user(CASHIER_A), "select public.refund_payment($1, 'pix duplicado')", [p.order_id])).toMatch(/PIN do gerente/);
    await one(user(CASHIER_A), "select public.request_approval($1, 'estornar', '7390')", [p.order_id]);
    await one(user(CASHIER_A), "select public.refund_payment($1, 'pix duplicado')", [p.order_id]);
    // A autorização vale uma vez só.
    const q = await createOrder(orderPayload({ channel: "telefone", customer_phone: "71977770003" }));
    await one(user(OWNER_A), "select public.transition_order($1, 'cancelado', 'teste dono')", [q.order_id]);
  });

  it("dono zera o PIN de alguém", async () => {
    expect((await one<{ n: number }>(user(OWNER_A), "select count(*)::int n from public.team_pins($1) where has_pin", [pzA])).n).toBeGreaterThanOrEqual(2);
    await one(user(OWNER_A), "select public.clear_member_pin($1, $2)", [pzA, CASHIER_A]);
    expect((await one<{ s: boolean }>(user(CASHIER_A), "select public.my_pin_status($1) s", [pzA])).s).toBe(false);
    expect(await fails(user(CASHIER_A), "select * from public.team_pins($1)", [pzA])).toMatch(/Sem permissão/);
  });
});

describe("funções abertas", () => {
  // O que o visitante sem login pode chamar: loja, acompanhamento, convite e as telas por link (cozinha e balcão).
  const ANON_OK = [
    "counter_open", "counter_staff", "get_order_tracking", "has_role", "invite_info", "is_member", "kitchen_move", "kitchen_open",
    "kitchen_tickets", "normalize_br_phone", "store_coupons", "valid_cpf",
    // Lê o caminho da foto no armazenamento (usada pelas regras de acesso das fotos dos produtos).
    "storage_pizzeria_id",
  ];
  it("visitante só executa as funções públicas", async () => {
    const r = await rows<{ proname: string }>(
      SERVICE,
      "select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1",
    );
    expect(r.map((x) => x.proname).filter((n) => !ANON_OK.includes(n))).toEqual([]);
  });
});

describe("caixa do dia", () => {
  const cur = (who: string) => one<{ c: { totals: Record<string, number>; can_see_expected: boolean } | null }>(user(who), "select public.cash_current($1) c", [pzA]).then((x) => x.c);

  it("abre um caixa por vez; cozinha não mexe", async () => {
    expect(await fails(user(KITCHEN_A), "select public.open_cash($1, 10000)", [pzA])).toMatch(/Sem permissão/);
    await one(user(CASHIER_A), "select public.open_cash($1, 10000)", [pzA]);
    expect(await fails(user(CASHIER_A), "select public.open_cash($1, 5000)", [pzA])).toMatch(/Já existe um caixa aberto/);
  });

  it("soma recebimentos por forma, sangria com PIN do gerente e esconde o esperado do caixa", async () => {
    await one(user(OWNER_A), "select public.set_my_pin($1, '7390')", [pzA]);
    const a = await createOrder(orderPayload({ channel: "telefone", customer_phone: "71988880001", payment_method: "dinheiro" }));
    await one(user(CASHIER_A), "select public.register_payment($1, 'dinheiro')", [a.order_id]);
    const b = await createOrder(orderPayload({ channel: "telefone", customer_phone: "71988880002", payment_method: "pix" }));
    await one(user(CASHIER_A), "select public.register_payment($1, 'pix')", [b.order_id]);
    await one(user(CASHIER_A), "select public.cash_movement($1, 'suprimento', 2000, 'troco extra')", [pzA]);
    expect(await fails(user(CASHIER_A), "select public.cash_movement($1, 'sangria', 3000, 'pagar gás')", [pzA])).toMatch(/PIN do gerente/);
    await one(user(CASHIER_A), "select public.request_cash_approval($1, '7390')", [pzA]);
    await one(user(CASHIER_A), "select public.cash_movement($1, 'sangria', 3000, 'pagar gás')", [pzA]);

    const forCashier = (await cur(CASHIER_A))!;
    expect(forCashier.can_see_expected).toBe(false);
    expect(forCashier.totals.esperado_gaveta).toBeUndefined();
    expect(forCashier.totals).toMatchObject({ abertura: 10000, dinheiro_balcao: 5000, pix: 5000, suprimentos: 2000, sangrias: 3000 });
    const forOwner = (await cur(OWNER_A))!;
    expect(forOwner.totals.esperado_gaveta).toBe(10000 + 5000 + 2000 - 3000);
  });

  it("fecha contando a gaveta e guarda a diferença", async () => {
    const r = await one<{ r: { esperado_gaveta: number; diferenca: number } }>(user(CASHIER_A), "select public.close_cash($1, 13500, 'faltou 5') r", [pzA]);
    expect(r.r.esperado_gaveta).toBe(14000);
    expect(r.r.diferenca).toBe(-500);
    expect(await cur(CASHIER_A)).toBeNull();
    const s = await one<{ status: string; difference_cents: number }>(user(OWNER_A), "select status, difference_cents from public.cash_sessions where pizzeria_id = $1 order by opened_at desc limit 1", [pzA]);
    expect(s).toEqual({ status: "fechado", difference_cents: -500 });
    expect(await rows(user(KITCHEN_A), "select id from public.cash_sessions")).toHaveLength(0);
    expect(await fails(user(CASHIER_A), "select public.cash_movement($1, 'suprimento', 100, 'teste')", [pzA])).toMatch(/Abra o caixa/);
  });
});

describe("permissões do gerente", () => {
  const MGR = "00000000-0000-4000-8000-0000000000f1";
  const NEWBIE = "00000000-0000-4000-8000-0000000000f2";
  const perms = (p: Record<string, boolean>) => one(user(OWNER_A), "select public.set_manager_perms($1, $2)", [pzA, p]);
  beforeAll(async () => {
    await db.query("insert into auth.users (id, email) values ($1, 'gerente@x.com'), ($2, 'novato@x.com')", [MGR, NEWBIE]);
    await one(user(OWNER_A), "select public.add_member_by_email($1, 'gerente@x.com', 'manager', 'Gil Gerente')", [pzA]);
  });

  it("padrão: gerente mexe no cardápio e cupons, mas não na equipe", async () => {
    expect(await rows(user(MGR), "update public.sizes set description = description where pizzeria_id = $1 returning id", [pzA])).not.toHaveLength(0);
    expect(await fails(user(MGR), "select * from public.team_invite($1)", [pzA])).toMatch(/Sem permissão/);
    expect(await fails(user(MGR), "select public.set_manager_perms($1, '{}')", [pzA])).toMatch(/Só o dono/);
  });

  it("dono tira cardápio, cupons, configurações e automações do gerente", async () => {
    await perms({ cardapio: false, cupons: false, configuracoes: false, automacoes: false });
    expect(await rows(user(MGR), "update public.sizes set description = description where pizzeria_id = $1 returning id", [pzA])).toHaveLength(0);
    expect(await rows(user(MGR), "select id from public.coupons where pizzeria_id = $1", [pzA])).toHaveLength(0);
    expect(await rows(user(MGR), "update public.pizzerias set name = name where id = $1 returning id", [pzA])).toHaveLength(0);
    expect(await rows(user(MGR), "select * from public.pizzeria_webhooks where pizzeria_id = $1", [pzA])).toHaveLength(0);
    // Dono continua podendo tudo.
    expect(await rows(user(OWNER_A), "update public.sizes set description = description where pizzeria_id = $1 returning id", [pzA])).not.toHaveLength(0);
    await perms({ cardapio: true, cupons: true, configuracoes: true, automacoes: true });
  });

  it("sem estorno liberado, gerente não estorna nem autoriza o caixa", async () => {
    await one(user(MGR), "select public.set_my_pin($1, '6043')", [pzA]);
    await perms({ estornar: false });
    const o = await createOrder(orderPayload({ channel: "telefone", customer_phone: "71912340001" }));
    await one(user(CASHIER_A), "select public.register_payment($1, 'pix')", [o.order_id]);
    expect(await fails(user(MGR), "select public.refund_payment($1, 'teste gerente')", [o.order_id])).toMatch(/não liberou estorno/);
    expect(await fails(user(CASHIER_A), "select public.request_approval($1, 'estornar', '6043')", [o.order_id])).toMatch(/PIN de gerente errado/);
    await perms({ estornar: true });
    await one(user(MGR), "select public.refund_payment($1, 'teste gerente')", [o.order_id]);
  });

  it("com equipe liberada, gerente aprova só funções abaixo dele", async () => {
    await perms({ equipe: true });
    await one(user(MGR), "select public.set_team_invite_active($1, true)", [pzA]);
    const code = (await one<{ code: string }>(user(MGR), "select * from public.team_invite($1)", [pzA])).code;
    await one(user(NEWBIE), "select public.request_join($1, 'Nina Novata', '52998224725', '71911112222')", [code]);
    const req = (await one<{ id: string }>(user(MGR), "select id from public.join_requests where user_id = $1", [NEWBIE])).id;
    expect(await fails(user(MGR), "select public.approve_join($1, 'manager')", [req])).toMatch(/só libera caixa/);
    await one(user(MGR), "select public.approve_join($1, 'attendant')", [req]);
    expect(await fails(user(MGR), "update public.members set role = 'manager' where pizzeria_id = $1 and user_id = $2 returning user_id", [pzA, NEWBIE])).toMatch(/row-level security/);
    expect(await rows(user(MGR), "update public.members set role = 'cashier' where pizzeria_id = $1 and user_id = $2 returning user_id", [pzA, NEWBIE])).toHaveLength(1);
    expect(await rows(user(MGR), "update public.members set role = 'kitchen' where pizzeria_id = $1 and user_id = $2 returning user_id", [pzA, OWNER_A])).toHaveLength(0);
    expect(await rows(user(MGR), "delete from public.members where pizzeria_id = $1 and user_id = $2 returning user_id", [pzA, NEWBIE])).toHaveLength(1);
    await perms({ equipe: false });
    expect(await fails(user(MGR), "select * from public.team_pins($1)", [pzA])).toMatch(/Sem permissão/);
  });
});
