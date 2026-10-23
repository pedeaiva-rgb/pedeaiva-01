import Image from "next/image";

/** Foto do produto, ou uma ilustração na identidade da marca quando ainda não há foto. */
export function ProductImage({ src, alt, size = 160, className = "" }: { src: string | null; alt: string; size?: number; className?: string }) {
  if (src) {
    return <Image src={src} alt={alt} width={size} height={size} sizes={`${size}px`} className={`aspect-square rounded-2xl object-cover ${className}`} />;
  }
  return (
    <div className={`grid aspect-square place-items-center rounded-2xl bg-cream ${className}`} style={{ width: "100%", maxWidth: size }} aria-hidden="true">
      <svg viewBox="0 0 48 48" className="h-1/2 w-1/2">
        <path d="M11 14 Q24 7 37 14" stroke="#F0A830" strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M12.5 17.5 L35.5 17.5 L24 37 Z" fill="#E4472D" />
        <circle cx="21" cy="22.5" r="2.1" fill="#FFFCF6" />
        <circle cx="27.5" cy="25" r="1.7" fill="#FFFCF6" />
      </svg>
    </div>
  );
}
