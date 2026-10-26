/** Contas e mensagens da tela de Clientes (puro: testável sem banco). */
export type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  birthday: string | null;
  notes: string | null;
  marketing_opt_out: boolean;
  created_at: string;
  orders: number;
  spent_cents: number;
  first_order_at: string | null;
  last_order_at: string | null;
};

export type Segment = "todos" | "melhores" | "sumidos" | "novos" | "aniversario" | "sem_pedido";

const DAY = 864e5;
export const daysSince = (iso: string | null, now: number) => (iso ? Math.floor((now - new Date(iso).getTime()) / DAY) : null);
/** Mês (1–12) e dia da data "AAAA-MM-DD" sem passar por fuso horário. */
const md = (d: string) => [Number(d.slice(5, 7)), Number(d.slice(8, 10))] as const;

/** Quem entra em cada filtro. "Sumidos": pediu antes, mas não há `awayDays` dias. "Melhores": os 20% que mais gastaram (mín. 2 pedidos). */
export function inSegment(list: CustomerRow[], seg: Segment, now: number, month: number, awayDays = 30): CustomerRow[] {
  switch (seg) {
    case "melhores": {
      const buyers = list.filter((c) => c.orders >= 2).sort((a, b) => b.spent_cents - a.spent_cents);
      return buyers.slice(0, Math.max(1, Math.ceil(buyers.length * 0.2)));
    }
    case "sumidos":
      return list.filter((c) => c.orders > 0 && (daysSince(c.last_order_at, now) ?? 0) >= awayDays);
    case "novos":
      return list.filter((c) => c.orders > 0 && (daysSince(c.first_order_at, now) ?? 999) < 30);
    case "aniversario":
      return list.filter((c) => c.birthday && md(c.birthday)[0] === month).sort((a, b) => md(a.birthday!)[1] - md(b.birthday!)[1]);
    case "sem_pedido":
      return list.filter((c) => c.orders === 0);
    default:
      return list;
  }
}

/** Só números e sem acento: "joão 7199" acha "João Silva (71) 99..." */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function search(list: CustomerRow[], q: string): CustomerRow[] {
  const t = norm(q.trim());
  if (!t) return list;
  const digits = t.replace(/\D/g, "");
  return list.filter((c) => norm(c.name).includes(t) || (digits.length >= 3 && c.phone.includes(digits)));
}

export type Template = "reativar" | "aniversario" | "premio" | "livre";
export const TEMPLATE_LABEL: Record<Template, string> = { reativar: "Sentimos sua falta", aniversario: "Aniversário", premio: "Prêmio / cupom", livre: "Mensagem livre" };

/** Mensagem pronta para o WhatsApp (a pessoa da loja revisa antes de enviar). */
export function message(t: Template, o: { customer: string; store: string; coupon?: string | null; link: string }): string {
  const first = o.customer.trim().split(/\s+/)[0] || "tudo bem";
  const cup = o.coupon ? ` Use o cupom *${o.coupon}* no próximo pedido.` : "";
  switch (t) {
    case "reativar":
      return `Oi, ${first}! Aqui é da ${o.store}. Faz tempo que você não pede com a gente e sentimos sua falta.${cup} Peça pelo link: ${o.link}`;
    case "aniversario":
      return `Feliz aniversário, ${first}! 🎉 A ${o.store} preparou um presente para você.${cup} Peça pelo link: ${o.link}`;
    case "premio":
      return `Oi, ${first}! Você ganhou um presente na ${o.store}.${cup} Peça pelo link: ${o.link}`;
    default:
      return `Oi, ${first}! Aqui é da ${o.store}. `;
  }
}

export const whatsappUrl = (phone: string, text: string) => `https://wa.me/55${phone}?text=${encodeURIComponent(text)}`;
