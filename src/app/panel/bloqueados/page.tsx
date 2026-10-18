import Link from "next/link";
import { Ban } from "lucide-react";
import { ClearReportButton } from "@/components/ClearReportButton";
import { Empty, PageHeader } from "@/components/ui";
import { BLOCK_REPORT_THRESHOLD } from "@/lib/api/reputation";
import { fmtDateTime, fmtPhone } from "@/lib/format";
import { requireAnalyst } from "@/lib/panel";
import { listBlockedNumbers } from "@/lib/repo";

export default async function BlockedNumbers() {
  const { orgId } = await requireAnalyst();
  const numbers = await listBlockedNumbers(orgId);

  return (
    <>
      <PageHeader
        crumbs={[
          { href: "/panel", label: "Análisis" },
          { href: "/panel/bloqueados", label: "Números bloqueados" },
        ]}
        title="Números bloqueados"
        description={`Cuántas veces se bloqueó cada número desde la app. Con ${BLOCK_REPORT_THRESHOLD} bloqueos queda reportado y la app avisa a todos cuando llama.`}
      />

      {numbers.length ? (
        <div className="overflow-x-auto rounded-3xl bg-surface shadow-soft">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface-2/70 text-[11px] uppercase tracking-wider text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Número</th>
                <th className="px-5 py-3 text-right font-medium">Veces bloqueado</th>
                <th className="px-5 py-3 text-right font-medium">Personas</th>
                <th className="px-5 py-3 text-right font-medium">Llamadas</th>
                <th className="px-5 py-3 font-medium">Último bloqueo</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {numbers.map((n) => {
                const shown = fmtPhone(n.number) ?? n.number;
                return (
                  <tr key={n.digits} className="border-b border-line last:border-0 hover:bg-accent-wash/50">
                    <td className="px-5 py-3.5">
                      <Link href={`/panel/casos?q=${n.digits}`} className="tabular font-semibold hover:text-accent">
                        {shown}
                      </Link>
                      {n.blocks >= BLOCK_REPORT_THRESHOLD && (
                        <span className="ml-2 rounded-full bg-critical-wash px-2 py-0.5 text-[11px] font-semibold text-critical-ink">
                          Reportado
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="tabular inline-flex items-center gap-1.5 rounded-full bg-critical-wash px-2.5 py-0.5 font-bold text-critical-ink">
                        <Ban size={12} aria-hidden />
                        {n.blocks}
                      </span>
                    </td>
                    <td className="tabular px-5 py-3.5 text-right">{n.people || <span className="text-muted" title="Las llamadas no tienen persona registrada">—</span>}</td>
                    <td className="tabular px-5 py-3.5 text-right text-fg-2">{n.calls}</td>
                    <td className="px-5 py-3.5 text-fg-2">{fmtDateTime(n.last_blocked)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <ClearReportButton number={n.number} label={shown} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Ningún número ha sido bloqueado todavía. Cuando alguien bloquea un número desde la app, aparece aquí.</Empty>
      )}
    </>
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
