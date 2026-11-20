"use client";

import type { ReactNode } from "react";
import { Theme } from "@astryxdesign/core/theme";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import { themes, defaultThemeSlug } from "@/astryx-themes";

/**
 * Raiz do piloto do Astryx. Envolve só as telas já migradas; o resto do app
 * segue em shadcn + Tailwind. Tema `myfin` (themes/myfin) reproduz os tokens do
 * DESIGN.md e é sempre claro.
 */
export function AstryxRoot({ children }: { children: ReactNode }) {
  return (
    <Theme theme={themes[defaultThemeSlug]} mode="light">
      {children}
    </Theme>
  );
}
