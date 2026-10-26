/**
 * Ponto de partida do cardápio de uma loja nova, conforme o tipo de negócio.
 * Tudo é editável depois; os tamanhos só existem para quem vende produto montado por tamanho.
 */
export type StoreKind = "pizzaria" | "hamburgueria" | "lanchonete" | "acai" | "restaurante" | "japonesa" | "doceria" | "outro";

type Size = { name: string; description: string; max_flavors: number };
export type StoreTemplate = { label: string; example: string; categories: string[]; sizes: Size[] };

export const STORE_TEMPLATES: Record<StoreKind, StoreTemplate> = {
  pizzaria: {
    label: "Pizzaria",
    example: "Ex.: Pizzaria do Bairro",
    categories: ["Pizzas", "Bebidas", "Sobremesas"],
    sizes: [
      { name: "Broto", description: "4 fatias", max_flavors: 1 },
      { name: "Média", description: "6 fatias", max_flavors: 2 },
      { name: "Grande", description: "8 fatias", max_flavors: 2 },
      { name: "Família", description: "12 fatias", max_flavors: 3 },
    ],
  },
  hamburgueria: { label: "Hamburgueria", example: "Ex.: Burguer da Esquina", categories: ["Lanches", "Combos", "Porções", "Bebidas", "Sobremesas"], sizes: [] },
  lanchonete: { label: "Lanchonete", example: "Ex.: Lanchonete Central", categories: ["Salgados", "Lanches", "Sucos e bebidas", "Doces"], sizes: [] },
  acai: {
    label: "Açaí e sorvetes",
    example: "Ex.: Açaí da Praça",
    categories: ["Açaí", "Sorvetes", "Bebidas"],
    sizes: [
      { name: "300 ml", description: "", max_flavors: 1 },
      { name: "500 ml", description: "", max_flavors: 2 },
      { name: "700 ml", description: "", max_flavors: 2 },
    ],
  },
  restaurante: { label: "Restaurante ou marmitaria", example: "Ex.: Restaurante Sabor Caseiro", categories: ["Pratos do dia", "Marmitas", "Porções", "Bebidas", "Sobremesas"], sizes: [] },
  japonesa: { label: "Comida japonesa", example: "Ex.: Sushi do Bairro", categories: ["Combinados", "Temakis", "Hot rolls", "Pratos quentes", "Bebidas"], sizes: [] },
  doceria: { label: "Doceria e confeitaria", example: "Ex.: Doces da Ana", categories: ["Bolos", "Doces", "Tortas", "Bebidas"], sizes: [] },
  outro: { label: "Outro tipo de negócio", example: "Ex.: Empório do Bairro", categories: ["Produtos", "Bebidas"], sizes: [] },
};

export const STORE_KINDS = Object.keys(STORE_TEMPLATES) as StoreKind[];
