import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empaqueta el servidor y solo sus dependencias reales: la imagen Docker
  // pasa de cientos de MB a unas decenas.
  output: "standalone",
};

export default nextConfig;
