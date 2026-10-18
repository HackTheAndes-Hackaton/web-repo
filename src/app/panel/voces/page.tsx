import { Empty, PageHeader } from "@/components/ui";
import { requireAnalyst } from "@/lib/panel";

export default async function ScammerVoices() {
  await requireAnalyst();
  return (
    <>
      <PageHeader
        crumbs={[
          { href: "/panel", label: "Análisis" },
          { href: "/panel/voces", label: "Voces de estafadores" },
        ]}
        title="Voces de estafadores"
      />
      <Empty>Próximamente.</Empty>
    </>
  );
}

// Datos en vivo: la navegación espera datos frescos a propósito.
export const instant = false;
