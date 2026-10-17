import Link from "next/link";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { listIncidentsForUser } from "@/lib/repo";
import { requireSession } from "@/lib/session";
import { CHANNEL_LABELS, type SignalType } from "@/lib/types";
import { Empty, PageHeader, RiskBadge, SignalChip, Tag } from "@/components/ui";

export default async function MyReports() {
  const session = await requireSession("usuario");
  const incidents = await listIncidentsForUser(session.userId);

  return (
    <div>
      <PageHeader
        crumbs={[
          { href: "/app", label: "Inicio" },
          { href: "/app/incidentes", label: "Mis reportes" },
        ]}
        title="Mis reportes"
        description="Revisa, corrige y decide qué compartes. Solo tú ves los reportes privados."
      />
      {incidents.length ? (
        <ul className="grid gap-3">
          {incidents.map((i) => (
            <li key={i.id}>
              <Link
                href={`/app/incidentes/${i.id}`}
                className="block rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-line-strong"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{i.title}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {fmtDateTime(i.started_at)} · {CHANNEL_LABELS[i.channel]} · {fmtDuration(i.started_at, i.ended_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {i.status === "en_curso" && <Tag tone="accent">En curso</Tag>}
                    {i.shared_org_id ? <Tag tone="good">✓ Compartido</Tag> : <Tag>Privado</Tag>}
                    <RiskBadge level={i.risk_level} score={i.risk_score} />
                  </div>
                </div>
                {i.signal_types && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {i.signal_types.split(",").map((t) => (
                      <SignalChip key={t} type={t as SignalType} />
                    ))}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Todavía no tienes reportes. Inicia una captura desde la pantalla de inicio.</Empty>
      )}
    </div>
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
