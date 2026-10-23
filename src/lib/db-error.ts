/** Erro do banco → mensagem em português para o usuário. */
export function dbError(e: unknown): string {
  const err = e as { message?: string; code?: string } | null;
  const m = err?.message ?? "";
  if (err?.code === "42501" || /row-level security|permission denied|Sem permissão/i.test(m)) return "Você não tem permissão para esta ação.";
  if (err?.code === "23505") return "Já existe um registro com esse nome.";
  if (err?.code === "23503") return "Este item está em uso e não pode ser apagado.";
  if (err?.code === "23514") return "Algum valor está fora do permitido.";
  if (m && m.length < 140 && !/JWT|fetch/i.test(m)) return m;
  return "Não foi possível salvar. Confira sua conexão e tente de novo.";
}
