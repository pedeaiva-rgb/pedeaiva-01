import type { Metadata } from "next";
import { SetupNotice } from "@/components/setup-notice";
import { supabaseConfigured } from "@/lib/supabase/env";
import { KitchenKiosk } from "./kitchen-kiosk";

export const metadata: Metadata = { title: "Cozinha", robots: { index: false } };

export default async function CozinhaLinkPage({ params }: PageProps<"/cozinha/[code]">) {
  if (!supabaseConfigured) return <SetupNotice />;
  const { code } = await params;
  return <KitchenKiosk code={code} />;
}
