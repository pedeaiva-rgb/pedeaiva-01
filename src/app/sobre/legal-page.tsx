import Link from "next/link";
import type { ReactNode } from "react";
import { PavLogo } from "@/components/brand/logo";
import { PLATFORM, PRIVACY_PATH, TERMS_PATH } from "@/lib/legal";

/** Moldura das páginas de termos e privacidade: texto corrido, fácil de ler no celular. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const company = [PLATFORM.legalName, PLATFORM.cnpj && `CNPJ ${PLATFORM.cnpj}`].filter(Boolean).join(" · ");
  return (
    <div className="min-h-dvh">
      <header className="border-b border-charcoal/10">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/" aria-label={`${PLATFORM.name}, início`}>
            <PavLogo tone="light" />
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-3xl font-extrabold">{title}</h1>
        <p className="mt-1 text-sm text-muted">Última atualização: {PLATFORM.updatedAt}</p>
        <article className="mt-6 text-[15px] leading-relaxed [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-extrabold [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </article>
      </main>
      <footer className="border-t border-charcoal/10">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted">
          <span>
            {PLATFORM.name}
            {company ? ` · ${company}` : ""}
          </span>
          <span className="flex gap-4">
            <Link href={TERMS_PATH} className="hover:underline">
              Termos de uso
            </Link>
            <Link href={PRIVACY_PATH} className="hover:underline">
              Privacidade
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

/** Como falar com a plataforma (some se o e-mail ainda não foi definido). */
export function ContactLine() {
  return PLATFORM.contactEmail ? (
    <>
      {" "}
      ou pelo e-mail{" "}
      <a className="font-bold underline" href={`mailto:${PLATFORM.contactEmail}`}>
        {PLATFORM.contactEmail}
      </a>
    </>
  ) : null;
}
