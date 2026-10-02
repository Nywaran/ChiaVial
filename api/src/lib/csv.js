/** Convierte filas en CSV UTF-8 (con BOM para que Excel muestre bien las tildes). */
export function aCsv(filas, columnas) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [columnas.join(","), ...filas.map((f) => columnas.map((c) => esc(f[c])).join(","))];
  return "﻿" + lineas.join("\n") + "\n";
}
