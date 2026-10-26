import Image from "next/image";

/** Foto do produto, ou uma ilustração na identidade da marca quando ainda não há foto. */
export function ProductImage({ src, alt, size = 160, className = "" }: { src: string | null; alt: string; size?: number; className?: string }) {
  if (src) {
    return <Image src={src} alt={alt} width={size} height={size} sizes={`${size}px`} className={`aspect-square rounded-2xl object-cover ${className}`} />;
  }
  return (
    <div className={`grid aspect-square place-items-center rounded-2xl bg-cream ${className}`} style={{ width: "100%", maxWidth: size }} aria-hidden="true">
      {/* Cúpula de servir: neutra, vale para qualquer tipo de comida. */}
      <svg viewBox="0 0 48 48" className="h-1/2 w-1/2">
        <circle cx="24" cy="12.5" r="2.6" fill="#F0A830" />
        <path d="M9 31 A15 15 0 0 1 39 31 Z" fill="#E4472D" />
        <path d="M15.5 26 A9 9 0 0 1 21 19.5" stroke="#FFFCF6" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <rect x="6" y="32" width="36" height="3.6" rx="1.8" fill="#16181B" />
      </svg>
    </div>
  );
}
