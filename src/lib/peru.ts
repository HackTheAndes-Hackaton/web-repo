/** Normalización sintáctica para Perú; no verifica titularidad ni existencia. */
export function normalizeTextPe(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function normalizePhonePe(value: string): string | null {
  if (!/^[+\d\s().-]+$/.test(value.trim())) return null;
  let digits = value.replace(/[\s().-]/g, "");
  if (digits.startsWith("0051")) digits = "+51" + digits.slice(4);
  if (digits.startsWith("+51")) digits = digits.slice(3);
  else if (/^51(?:9\d{8}|[1-8]\d{7})$/.test(digits)) digits = digits.slice(2);
  else if (digits.startsWith("+")) return null;
  // Prefijo nacional 0: solo con número fijo y código de área completo.
  if (/^0[1-8]\d{7}$/.test(digits)) digits = digits.slice(1);
  return /^(?:9\d{8}|[1-8]\d{7})$/.test(digits) ? `+51${digits}` : null;
}

function accountDigits(value: string) {
  if (!/^[\d\s-]+$/.test(value)) return null;
  const digits = value.replace(/[\s-]/g, "");
  return /^\d{6,20}$/.test(digits) ? digits : null;
}

export function normalizeBankPe(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 80) return null;
  const bank = normalizeTextPe(value).replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string> = {
    bcp: "bcp", bancodecredito: "bcp", bancodecreditodelperu: "bcp",
    bbva: "bbva", bbvaperu: "bbva", bbvacontinental: "bbva", bancocontinental: "bbva",
    interbank: "interbank", bancointernacionaldelperu: "interbank",
    bn: "banco_nacion", bancodelanacion: "banco_nacion",
    scotiabank: "scotiabank", scotiabankperu: "scotiabank",
  };
  return aliases[bank] ?? (bank || null);
}

export function normalizeAmountPe(value: string, currency?: unknown): string | null {
  let amount = value.trim().replace(/^(?:S\s*\/\s*\.?|US\s*\$|USD|PEN|\$)\s*/i, "")
    .replace(/\s*(?:soles|sol|d[oó]lares|PEN|USD)$/i, "").replace(/\s/g, "");
  if (!/^\d(?:[\d.,]*\d)?$/.test(amount)) return null;
  const separators = [...amount.matchAll(/[.,]/g)];
  const last = separators.at(-1);
  if (last && amount.length - last.index! - 1 <= 2) {
    const head = amount.slice(0, last.index);
    if (/[.,]/.test(head) && !/^\d{1,3}(?:[.,]\d{3})+$/.test(head)) return null;
    amount = head.replace(/[.,]/g, "") + "." + amount.slice(last.index! + 1);
  } else if (separators.length) {
    if (!/^\d{1,3}(?:,\d{3})+$/.test(amount) && !/^\d{1,3}(?:\.\d{3})+$/.test(amount)) return null;
    amount = amount.replace(/[.,]/g, "");
  }
  const [integer, fraction = ""] = amount.split(".");
  const normalized = `${integer.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`;
  let code = typeof currency === "string" ? currency.toUpperCase() : null;
  if (!code && (/S\s*\/|\bsol(?:es)?\b|\bPEN\b/i.test(value))) code = "PEN";
  if (!code && (/US\s*\$|\bUSD\b|\bd[oó]lares\b/i.test(value))) code = "USD";
  return code && /^(PEN|USD)$/.test(code) ? `${code}:${normalized}` : `moneda_desconocida:${normalized}`;
}

export function normalizeObservedEntityPe(kind: string, value: string, meta: Record<string, unknown> = {}) {
  let result: string | null = null;
  if (kind === "telefono") result = normalizePhonePe(value);
  else if (kind === "cci") {
    const digits = accountDigits(value);
    result = digits?.length === 20 ? digits : null;
  } else if (kind === "cuenta") {
    const digits = accountDigits(value);
    result = digits ? `${normalizeBankPe(meta.bank) ?? "banco_desconocido"}:${digits}` : null;
  } else if (kind === "billetera") {
    const phone = normalizePhonePe(value);
    const wallet = typeof meta.wallet === "string" ? normalizeTextPe(meta.wallet) : "desconocida";
    result = phone ? `${wallet}:${phone}` : null;
  }
  else if (kind === "monto") result = normalizeAmountPe(value, meta.currency);
  else return normalizeTextPe(value);
  return result ?? `sin_normalizar:${normalizeTextPe(value)}`;
}

export interface ComparableEntityPe {
  kind: string;
  value: string;
  analysis_meta?: Record<string, unknown>;
}

/** Recalcula desde el original; nunca confía en un normalized aportado por el cliente. */
export function entityMatchKeyPe(entity: ComparableEntityPe): string | null {
  const meta = entity.analysis_meta ?? {};
  if (meta.country != null && meta.country !== "PE") return null;
  if (entity.kind === "telefono") {
    const phone = normalizePhonePe(entity.value);
    return phone ? `telefono:${phone}` : null;
  }
  if (entity.kind === "cci") {
    const digits = accountDigits(entity.value);
    return digits?.length === 20 ? `cci:${digits}` : null;
  }
  if (entity.kind === "cuenta") {
    const digits = accountDigits(entity.value), bank = normalizeBankPe(meta.bank);
    return digits && bank ? `cuenta:${bank}:${digits}` : null;
  }
  if (entity.kind === "billetera") {
    const phone = normalizePhonePe(entity.value);
    const wallet = typeof meta.wallet === "string" ? normalizeTextPe(meta.wallet) : "";
    return phone && ["yape", "plin"].includes(wallet) ? `billetera:${wallet}:${phone}` : null;
  }
  return null;
}
