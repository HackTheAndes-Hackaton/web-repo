import fs from "node:fs/promises";
import ts from "typescript";

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  // La prueba de persistencia no ejecuta tareas posteriores a una respuesta HTTP.
  if (specifier === "next/server" && context.parentURL?.endsWith('/api/crud.ts')) {
    return { url: "data:text/javascript,export function after(){}", shortCircuit: true };
  }
  if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !/\.[cm]?[jt]s$/.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.endsWith('.ts')) {
    const source = await fs.readFile(new URL(url), 'utf8');
    return { format: 'module', source: ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true };
  }
  return next(url, context);
}
