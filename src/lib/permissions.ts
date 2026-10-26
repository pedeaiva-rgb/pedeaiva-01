import type { Role } from "./types";

/** O que o dono libera para o gerente (espelho de public.manager_settings; o banco é quem decide). */
export type ManagerPerms = {
  cardapio: boolean;
  cupons: boolean;
  configuracoes: boolean;
  automacoes: boolean;
  estornar: boolean;
  faturamento: boolean;
  equipe: boolean;
};

/** Padrão: o gerente faz tudo, menos cuidar da equipe (como era antes das permissões). */
export const DEFAULT_MANAGER_PERMS: ManagerPerms = {
  cardapio: true,
  cupons: true,
  configuracoes: true,
  automacoes: true,
  estornar: true,
  faturamento: true,
  equipe: false,
};
export const FULL_PERMS: ManagerPerms = { ...DEFAULT_MANAGER_PERMS, equipe: true };

export const PERM_LABEL: Record<keyof ManagerPerms, { title: string; hint: string }> = {
  cardapio: { title: "Cardápio e preços", hint: "Produtos, preços, fotos, categorias e tamanhos" },
  cupons: { title: "Cupons", hint: "Criar, editar e mostrar cupons na loja" },
  configuracoes: { title: "Configurações da loja", hint: "Horário, taxas e bairros de entrega, links da cozinha e do balcão" },
  automacoes: { title: "WhatsApp e automações", hint: "Endereço do n8n e avisos aos clientes" },
  estornar: { title: "Estornar pagamento", hint: "Estornar e autorizar estorno do caixa" },
  faturamento: { title: "Ver o faturamento", hint: "Valores vendidos e recebidos na Visão geral" },
  equipe: { title: "Cuidar da equipe", hint: "Aprovar acessos e mudar função de caixa, atendente, cozinha e entregador" },
};

/** Áreas do menu que dependem do que o dono liberou para o gerente. */
const GATED = ["cardapio", "cupons", "configuracoes", "automacoes", "equipe"] as const;
type Gated = (typeof GATED)[number];
const isGated = (a: string): a is Gated => (GATED as readonly string[]).includes(a);

/** A função tem a área e, se for gerente, o dono liberou. */
export function areaAllowed(role: Role, perms: ManagerPerms, area: string, access: Record<string, readonly Role[]>) {
  if (!(access[area] ?? []).includes(role)) return false;
  return role !== "manager" || !isGated(area) || perms[area];
}
