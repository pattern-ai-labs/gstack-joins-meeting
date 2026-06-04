import { ImageResponse } from "next/og";

// App favicon — rendered at build time. Lime G on dark, matching the
// brand mark we use in the sidebar + landing.
export const runtime = "edge";
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#b9f450",
          color: "#07080a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 44,
          fontWeight: 800,
          fontFamily: "Inter, system-ui, sans-serif",
          borderRadius: 12,
        }}
      >
        G
      </div>
    ),
    { ...size },
  );
}
