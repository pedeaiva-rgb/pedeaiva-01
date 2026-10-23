"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Recarrega os dados da página de tempos em tempos (sem recarregar a página inteira). */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
