/** CPF — espelho de public.valid_cpf (o banco decide; aqui é o aviso antecipado). */
export const CPF_ERROR = "CPF inválido";

export function validCpf(raw: string | null | undefined): boolean {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digit = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

/** 529.982.247-25 enquanto digita (no máximo 11 dígitos). */
export function maskCpf(typed: string): string {
  const d = typed.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** ***.982.247-** para mostrar na tela da equipe sem expor o CPF inteiro. */
export function hideCpf(cpf: string): string {
  return /^\d{11}$/.test(cpf) ? `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**` : cpf;
}
