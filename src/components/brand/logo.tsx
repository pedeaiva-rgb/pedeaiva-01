/**
 * Logo oficial "Pede aí e vá" (vetorial).
 * Símbolo: uma fatia de pizza cuja ponta vira um caminho para a frente (pedido → cozinha → entrega).
 */
const TOMATO = "#E4472D";
const DENDE = "#F0A830";
const CHARCOAL = "#16181B";
const CREAM = "#F5EFE4";

type Tone = "light" | "dark";

export function PavSymbol({ size = 40, tone = "light" }: { size?: number; tone?: Tone }) {
  const bg = tone === "light" ? CHARCOAL : CREAM;
  const line = tone === "light" ? CREAM : CHARCOAL;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="13" fill={bg} />
      <path d="M11 14 Q24 7 37 14" stroke={DENDE} strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M12.5 17.5 L35.5 17.5 L24 37 Z" fill={TOMATO} />
      <circle cx="21" cy="22.5" r="2.1" fill={line} />
      <circle cx="27.5" cy="25" r="1.7" fill={line} />
      <path
        d="M26 37 H36 L32.5 33.5 M36 37 L32.5 40.5"
        stroke={line}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function PavLogo({
  tone = "light",
  compact = false,
  className = "",
}: {
  tone?: Tone;
  compact?: boolean;
  className?: string;
}) {
  const ink = tone === "light" ? "text-charcoal" : "text-cream";
  if (compact) {
    return (
      <span role="img" aria-label="Pede aí e vá" className={`inline-flex items-center gap-2 ${className}`}>
        <PavSymbol size={34} tone={tone} />
        <span className={`font-brand text-[13px] leading-[0.95] font-extrabold tracking-tight ${ink}`}>
          Pede aí
          <br />
          <span className="text-tomato">e vá</span>
        </span>
      </span>
    );
  }
  return (
    <span role="img" aria-label="Pede aí e vá" className={`inline-flex items-center gap-2.5 ${className}`}>
      <PavSymbol size={38} tone={tone} />
      <span className={`font-brand text-[22px] font-extrabold tracking-tight ${ink}`}>
        Pede aí <span className="text-tomato">e vá</span>
      </span>
    </span>
  );
}
