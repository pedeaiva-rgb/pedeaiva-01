"use client";

/** "42,90" → mostra "R$ 42,90". O valor guardado continua no formato que parseMoney entende. */
const fmt = (cents: number) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Converte o que foi digitado (só os números contam) em "1.234,56"; vazio continua vazio. */
export function maskMoney(typed: string): string {
  const digits = typed.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9);
  return digits ? fmt(Number(digits)) : "";
}

/**
 * Campo de dinheiro como em app de banco: digita só números e o valor aparece em reais
 * (4290 → R$ 42,90). `value` e `onChange` usam o texto sem o "R$" (ex.: "42,90").
 */
export function MoneyInput({
  value,
  onChange,
  onBlur,
  className = "field",
  placeholder = "R$ 0,00",
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: (v: string) => void;
  className?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <input
      {...rest}
      className={className}
      inputMode="numeric"
      placeholder={placeholder}
      value={value ? `R$ ${value}` : ""}
      onChange={(e) => onChange(maskMoney(e.target.value))}
      onBlur={() => onBlur?.(value)}
    />
  );
}
