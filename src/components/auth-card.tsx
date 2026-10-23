import Link from "next/link";
import type { ReactNode } from "react";
import { PavLogo } from "./brand/logo";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 inline-block">
          <PavLogo />
        </Link>
        <div className="card p-7">
          <h1 className="text-2xl font-extrabold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-sm">{footer}</div>}
      </div>
    </main>
  );
}
