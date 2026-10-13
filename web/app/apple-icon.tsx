import { ImageResponse } from "next/og";
import { markPaths } from "@/components/Mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: full-bleed paper (iOS rounds the corners) with the engraved dial. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: 180, height: 180, display: "flex", alignItems: "center", justifyContent: "center", background: "#EDF1EC" }}>
        <svg width="140" height="140" viewBox="0 0 100 100">
          {markPaths(2, "#17332B", "#C0266D")}
        </svg>
      </div>
    ),
    size,
  );
}
