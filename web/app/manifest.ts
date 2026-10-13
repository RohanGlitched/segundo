import type { MetadataRoute } from "next";

/** Segundo on a home screen: opens straight to your tabs, full screen, in the paper colour of the site. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "Segundo",
    short_name: "Segundo",
    description: "Get paid every second you work. Clients abroad fund a tab in AUSD; pay lands on Monad while you're clocked in.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#EDF1EC",
    theme_color: "#EDF1EC",
    categories: ["finance", "business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Your tabs", url: "/app" },
      { name: "Open a tab", url: "/open" },
      { name: "Send AUSD", url: "/app?send=1" },
    ],
  };
}
