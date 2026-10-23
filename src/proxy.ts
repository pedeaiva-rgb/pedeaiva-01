import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL, supabaseConfigured } from "@/lib/supabase/env";

/** Renova a sessão do Supabase a cada navegação e manda para o login quem abre o painel sem estar logado. */
export async function proxy(request: NextRequest) {
  if (!supabaseConfigured) return NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && request.nextUrl.pathname.startsWith("/painel")) {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Só páginas: arquivos estáticos e imagens não precisam de sessão.
  matcher: ["/((?!_next/static|_next/image|brand/|icon.svg|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
