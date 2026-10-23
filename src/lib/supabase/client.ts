"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

let client: SupabaseClient | undefined;

/** Cliente do navegador (sessão em cookies, compartilhada com o servidor). */
export function browserClient() {
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}
