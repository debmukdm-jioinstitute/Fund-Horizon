import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: BRAND.description,
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: BRAND.navy,
    icons: [{ src: BRAND.emblem, sizes: "any", type: "image/png" }],
  };
}
