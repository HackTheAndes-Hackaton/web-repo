"use client";

import { buttonCls } from "./ui";

export function PrintButton() {
  return (
    <button className={`${buttonCls.secondary} no-print`} onClick={() => window.print()}>
      Imprimir / PDF
    </button>
  );
}
