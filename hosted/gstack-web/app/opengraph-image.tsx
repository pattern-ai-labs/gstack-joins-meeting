import { ImageResponse } from "next/og";

// OG image — generated at build time, served at /opengraph-image.
// Mirrors the brand lockup (public/logos/gstack-x-agentcall-lockup.svg):
// lime gstack ✕ cream agentcall over the JOINS YOUR MEETING tagline.
// The ✕ is drawn as two rotated bars instead of a text glyph — Satori's
// bundled Inter subset may not include U+2715 and we'd ship tofu.
export const runtime = "edge";
export const alt = "gstack × agentcall — joins your meeting";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LIME = "#c8ff3a";
const CREAM = "#f4eedd";
const ORANGE = "#ff6b2b";
const INK_BG = "#07080a";

function Cross() {
  return (
    <div style={{ display: "flex", position: "relative", width: 72, height: 72, margin: "0 28px" }}>
      <div style={{
        position: "absolute", left: 31, top: 2, width: 11, height: 68,
        background: ORANGE, borderRadius: 6, transform: "rotate(45deg)",
      }} />
      <div style={{
        position: "absolute", left: 31, top: 2, width: 11, height: 68,
        background: ORANGE, borderRadius: 6, transform: "rotate(-45deg)",
      }} />
    </div>
  );
}

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
          backgroundColor: INK_BG,
          backgroundImage:
            "radial-gradient(800px 500px at 80% -10%, rgba(200, 255, 58, 0.16), transparent 60%), " +
            "radial-gradient(600px 400px at 0% 110%, rgba(255, 107, 43, 0.08), transparent 60%)",
          color: "#ecedef",
        }}
      >
        {/* top: the two brand tiles, side by side */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: LIME, color: INK_BG,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26, fontWeight: 800,
          }}>G</div>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: CREAM, color: "#16140d",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26, fontWeight: 700,
          }}>A</div>
        </div>

        {/* center: the lockup */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: 104, fontWeight: 800, letterSpacing: -4, color: LIME }}>gstack</span>
            <Cross />
            <span style={{ fontSize: 104, fontWeight: 800, letterSpacing: -4, color: CREAM }}>agentcall</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
            <div style={{ width: 120, height: 2, background: "#5c6052" }} />
            <span style={{ fontSize: 24, letterSpacing: 13, color: "#9aa08c" }}>JOINS YOUR MEETING</span>
            <div style={{ width: 120, height: 2, background: "#5c6052" }} />
          </div>
        </div>

        {/* bottom: provenance */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 19,
            color: "#6a707a",
          }}
        >
          <div style={{ display: "flex" }}>
            built on&nbsp;<span style={{ color: "#ecedef" }}>garrytan/gstack</span>&nbsp;+&nbsp;<span style={{ color: "#ecedef" }}>agentcall.dev</span>
          </div>
          <div>open source · MIT</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
