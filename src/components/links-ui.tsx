import type { LinkReason } from "@/lib/types";

const REASON_ICON: Record<LinkReason["kind"], string> = { voz: "◉", dato_compartido: "#", contenido: "≈" };
const REASON_LABEL: Record<LinkReason["kind"], string> = {
  voz: "Voz",
  dato_compartido: "Dato repetido",
  contenido: "Patrón de señales",
};

export function LinkReasons({ reasons }: { reasons: LinkReason[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {reasons.map((r, i) => (
        <li key={i} className="flex gap-2 text-xs text-fg-2">
          <span aria-hidden className="w-3 shrink-0 text-center text-muted">
            {REASON_ICON[r.kind]}
          </span>
          <span>
            <span className="font-medium text-fg">{REASON_LABEL[r.kind]}:</span> {r.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}
