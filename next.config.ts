import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // db.ts lee las migraciones en tiempo de ejecución para crear el esquema;
  // en Vercel solo se despliegan los archivos trazados, así que se incluyen aquí.
  outputFileTracingIncludes: {
    "/**": ["./supabase/migrations/**/*"],
  },
  partialPrefetching: true,
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
