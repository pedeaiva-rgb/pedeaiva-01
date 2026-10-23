"use client";

/**
 * Formata enquanto digita: (71) 99999-0001 no celular, (71) 3456-7890 no fixo.
 * Aceita no máximo 11 dígitos (DDD + número); colar com +55 ou 0 na frente também funciona.
 */
export function maskPhone(typed: string): string {
  let d = typed.replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length > 11 && d.startsWith("0")) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  d = d.slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  const split = d.length === 11 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

export function PhoneInput({
  value,
  onChange,
  className = "field",
  placeholder = "(71) 99999-0001",
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  required?: boolean;
  "aria-label"?: string;
}) {
  return (
    <input
      {...rest}
      type="tel"
      autoComplete="tel"
      inputMode="numeric"
      maxLength={15}
      className={className}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(maskPhone(e.target.value))}
    />
  );
}
