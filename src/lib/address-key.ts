import type { Address } from "./types";

/** Texto comparável: sem acento, minúsculo, sem pontuação; "R." e "Av." viram "rua" e "avenida". */
export function normalizePlace(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\br\.\s*/g, "rua ")
    .replace(/\bav\.\s*/g, "avenida ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Número que não ajuda a achar a casa ("0", "s/n", "sn"). */
export const blankNumber = (n: string) => /^(0+|s\s*\/?\s*n|sem numero|sem número)?$/i.test(n.trim());

/** Chaves do endereço: exata (rua + número + bairro) e da rua (rua + bairro). */
export function addressKeys(a: Pick<Address, "street" | "number" | "neighborhood">): { full: string | null; street: string } {
  const street = normalizePlace(a.street);
  const hood = normalizePlace(a.neighborhood);
  return { full: blankNumber(a.number) ? null : `${street}|${normalizePlace(a.number)}|${hood}`, street: `${street}||${hood}` };
}

/**
 * Buscas no mapa para o endereço do cliente, da mais precisa para a mais geral.
 * `exact` diz quantas das primeiras contam como ponto exato; as demais são só aproximadas.
 */
export function customerQueries(a: Address, city: string | null): { queries: string[]; exact: number } {
  const c = city ? `, ${city}` : "";
  const num = blankNumber(a.number) ? "" : `, ${a.number}`;
  const extra = (a.complement ?? "").trim();
  const exactQ = [
    ...(num ? [`${a.street}${num}, ${a.neighborhood}${c}`] : []),
    `${a.street}, ${a.neighborhood}${c}`,
    ...(extra ? [`Condomínio ${extra}${c}`, `${extra}, ${a.neighborhood}${c}`] : []),
  ];
  return { queries: [...exactQ, `${a.neighborhood}${c}`], exact: exactQ.length };
}
