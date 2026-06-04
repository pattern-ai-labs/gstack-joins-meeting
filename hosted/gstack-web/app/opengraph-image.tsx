import { ImageResponse } from "next/og";

// OG image — generated at build time, served at /opengraph-image.
// Renders the hero text + the Garry credit on a dark gradient so the
// link preview tells the whole story before anyone clicks.
export const runtime = "edge";
export const alt = "gstack joins your meeting — voice agents for every gstack specialist";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          fontFamily: "Inter, system-ui, sans-serif",
          background:
            "radial-gradient(800px 500px at 80% -10%, rgba(185, 244, 80, 0.18), transparent 60%), " +
            "radial-gradient(600px 400px at 0% 110%, rgba(96, 165, 250, 0.10), transparent 60%), " +
            "#07080a",
          color: "#ecedef",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 44, height: 44,
              borderRadius: 10,
              background: "#b9f450",
              color: "#07080a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26, fontWeight: 800,
            }}
          >G</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.4 }}>gstack</span>
            <span style={{ fontSize: 18, color: "#6a707a", fontFamily: "monospace" }}>joins your meeting</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontSize: 84,
              lineHeight: 0.95,
              fontWeight: 600,
              letterSpacing: -2.5,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span><span style={{ color: "#b9f450" }}>gstack</span> joins</span>
            <span>your meeting.</span>
          </div>
          <div style={{ fontSize: 24, color: "#b3b7be", maxWidth: 950, lineHeight: 1.3 }}>
            Every gstack specialist — CEO, CSO, QA Lead, Senior Designer, SRE —
            joins your Google Meet as a voice bot with its own 3D avatar.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 18,
            color: "#6a707a",
            fontFamily: "monospace",
          }}
        >
          <div>built on <span style={{ color: "#ecedef" }}>garrytan/gstack</span> + <span style={{ color: "#ecedef" }}>agentcall.dev</span></div>
          <div>open source · MIT</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
