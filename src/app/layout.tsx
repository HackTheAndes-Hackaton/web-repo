import type { Metadata } from "next";
import "./globals.css";
import { APP_NAME } from "@/lib/format";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Asistente con IA para reconocer posibles estafas y extorsiones durante una conversación.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
