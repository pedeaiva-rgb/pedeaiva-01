import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Fotos de produtos ficam no Supabase Storage.
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
