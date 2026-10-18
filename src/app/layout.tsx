import type { Metadata } from "next";
import "./globals.css";
import { APP_NAME } from "@/lib/format";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Asistente con IA para reconocer posibles estafas y extorsiones durante una conversación.",
  // Dark Reader modifica atributos e iconos antes de la hidratación de React.
  other: { "darkreader-lock": "true" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      {/* Tolera solo atributos del body añadidos por extensiones como Grammarly. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>{children}</body>
    </html>
  );
}
