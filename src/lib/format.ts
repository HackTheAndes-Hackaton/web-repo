export const APP_NAME = "Tiskz";

const dateTime = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });
const timeOnly = new Intl.DateTimeFormat("es-MX", { timeStyle: "short" });
const dayShort = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });

export function fmtDateTime(iso: string) {
  return dateTime.format(new Date(iso));
}

export function fmtTime(iso: string) {
  return timeOnly.format(new Date(iso));
}

export function fmtDay(isoDay: string) {
  return dayShort.format(new Date(`${isoDay}T12:00:00`));
}

export function fmtDuration(fromIso: string, toIso: string | null) {
  const secs = Math.max(0, Math.round(((toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso)) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m ? `${m} min ${s.toString().padStart(2, "0")} s` : `${s} s`;
}

export function fmtOffset(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

export function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

/** Número legible: +52 55 2841 7730 para México; el resto tal como llega. */
export function fmtPhone(raw: string | null | undefined) {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  const mx = digits.match(/^\+52(\d{2})(\d{4})(\d{4})$/);
  if (mx) return `+52 ${mx[1]} ${mx[2]} ${mx[3]}`;
  return raw;
}
