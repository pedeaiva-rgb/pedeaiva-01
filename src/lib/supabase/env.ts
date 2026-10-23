// Variáveis NEXT_PUBLIC_ precisam ser lidas literalmente para irem para o navegador.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** Enquanto o Supabase não estiver configurado, o site mostra instruções em vez de quebrar. */
export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);
