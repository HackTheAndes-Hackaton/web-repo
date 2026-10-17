import type { LinkReason, LinkStatus } from "@/lib/types";
import { Tag } from "./ui";

const REASON_ICON: Record<LinkReason["kind"], string> = { voz: "◉", dato_compartido: "#", contenido: "≈" };
const REASON_LABEL: Record<LinkReason["kind"], string> = {
  voz: "Voz",
  dato_compartido: "Dato repetido",
  contenido: "Contenido",
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

export function LinkStatusTag({ status }: { status: LinkStatus }) {
  if (status === "confirmado") return <Tag tone="accent">✓ Confirmado</Tag>;
  if (status === "descartado") return <Tag>✕ Descartado</Tag>;
  return <Tag tone="warning">◌ Pendiente</Tag>;
}
