import type { MetadataRoute } from "next";

const LEGAL_PATHS = [
  "/uyelik-sozlesmesi",
  "/kvkk-aydinlatma-metni",
  "/gizlilik-politikasi",
  "/cerez-politikasi",
  "/iptal-iade-politikasi",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return [
    {
      url: base,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    ...LEGAL_PATHS.map((path) => ({
      url: `${base}${path}`,
      lastModified: new Date(),
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];
}
