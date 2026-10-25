import type { Metadata } from "next";
import { SetupNotice } from "@/components/setup-notice";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CounterKiosk } from "./counter-kiosk";

export const metadata: Metadata = { title: "Balcão", robots: { index: false } };

export default async function BalcaoPage({ params }: PageProps<"/balcao/[code]">) {
  if (!supabaseConfigured) return <SetupNotice />;
  const { code } = await params;
  return <CounterKiosk code={code} />;
}
