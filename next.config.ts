import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Uploads (OFX, diario.csv, planilha da B3, nota em PDF) vão por
      // Server Action. O padrão do Next é 1 MB; a Vercel recusa corpos acima
      // de 4,5 MB. 4 MB de arquivo + folga do multipart fica abaixo disso.
      // Os limites por arquivo nas actions não passam de 4 MB.
      bodySizeLimit: "4.1mb",
    },
  },
};

export default nextConfig;
