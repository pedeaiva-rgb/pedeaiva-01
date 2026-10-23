import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Destino dos links enviados por e-mail (confirmação de conta e nova senha). */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const nextParam = url.searchParams.get("next") ?? "/painel";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/painel";
  const supabase = await createClient();

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("link incompleto") };

  const dest = url.clone();
  dest.search = "";
  if (error) {
    dest.pathname = "/entrar";
    dest.searchParams.set("erro", "link");
  } else dest.pathname = next;
  return NextResponse.redirect(dest);
}
