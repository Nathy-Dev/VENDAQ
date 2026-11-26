import type { MetadataRoute } from "next";
import { publicPages, siteOrigin } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return Object.keys(publicPages).map((path) => ({ url: `${siteOrigin}${path}` }));
}
