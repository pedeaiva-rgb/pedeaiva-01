import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });

export const metadata: Metadata = {
  title: { default: "Pede aí, vá", template: "%s · Pede aí, vá" },
  description: "Cardápio online, pedidos, mesas e PDV para delivery, restaurantes e lanchonetes, em um só sistema.",
};

export const viewport: Viewport = { themeColor: "#16181B" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${jakarta.variable} ${bricolage.variable}`}>
      <body className="min-h-dvh">
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
