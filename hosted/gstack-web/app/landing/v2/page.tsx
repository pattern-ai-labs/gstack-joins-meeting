/* Sketchbook variant of the landing — adopts AgentCall's design system
 * (cream paper, black ink, lime accent, ink-stamp shadows, Inter +
 * Instrument Serif italic + JetBrains Mono). Standalone full-bleed
 * page; opt-in via /landing/v2.
 *
 * Side-by-side comparison with the dark default at /landing.
 */
import Link from "next/link";

const SPECIALISTS = [
  { id: "office-hours",       name: "YC Office Hours",   role: "Partner",            glyph: "YC" },
  { id: "plan-ceo-review",    name: "CEO",               role: "Strategy",           glyph: "♛" },
  { id: "plan-eng-review",    name: "Eng Manager",       role: "Architecture",       glyph: "⎇" },
  { id: "plan-design-review", name: "Senior Designer",   role: "Design rubric",      glyph: "◈" },
  { id: "plan-devex-review",  name: "DX Lead",           role: "Developer XP",       glyph: "❮❯" },
  { id: "design-consultation",name: "Design Partner",    role: "System direction",   glyph: "✦" },
  { id: "design-shotgun",     name: "Design Explorer",   role: "Mockup variants",    glyph: "⁂" },
  { id: "design-html",        name: "Design Engineer",   role: "Production HTML",    glyph: "</>" },
  { id: "review",             name: "Staff Engineer",    role: "Code review",        glyph: "⌘" },
  { id: "investigate",        name: "Debugger",          role: "Root-cause",         glyph: "⌕" },
  { id: "design-review",      name: "Designer Who Codes",role: "Live UI audit",      glyph: "◐" },
  { id: "devex-review",       name: "DX Tester",         role: "Run → feel",         glyph: "▤" },
  { id: "qa",                 name: "QA Lead",           role: "Tests + edges",      glyph: "✓" },
  { id: "cso",                name: "CSO",               role: "OWASP threat model", glyph: "⛨" },
  { id: "ship",               name: "Release Engineer",  role: "PR + deploy",        glyph: "▲" },
  { id: "land-and-deploy",    name: "Deploy Engineer",   role: "Merge + verify",     glyph: "⇧" },
  { id: "canary",             name: "SRE",               role: "Logs + rollback",    glyph: "☀" },
  { id: "retro",              name: "Retro Facilitator", role: "Shipped / slipped",  glyph: "↻" },
  { id: "spec",               name: "Spec Partner",      role: "5-phase interrogator", glyph: "§" },
];

export const metadata = {
  title: "gstack joins your meeting — sketchbook variant",
  description: "An alternate landing in AgentCall's sketchbook aesthetic.",
};

export default function LandingV2() {
  return (
    <>
      <style>{styles}</style>
      <div className="sk">
        <Topbar />
        <Cover />
        <Ribbon />
        <Roster />
        <How />
        <Install />
        <Thanks />
        <Foot />
      </div>
    </>
  );
}

function Topbar() {
  return (
    <header className="sk-topbar">
      <div className="sk-wrap sk-topbar-inner">
        <Link href="/" className="sk-brand">
          <span className="sk-mark">G</span>
          <span><strong>gstack</strong> <em>joins your meeting</em></span>
        </Link>
        <nav className="sk-nav">
          <a href="#how">How it works</a>
          <a href="#install">Install</a>
          <a href="https://github.com/pattern-ai-labs/gstack-joins-meeting" target="_blank" rel="noopener noreferrer">GitHub</a>
          <Link href="/" className="sk-btn sk-btn-lime">Try now →</Link>
        </nav>
      </div>
    </header>
  );
}

function Cover() {
  return (
    <section className="sk-cover">
      <div className="sk-cover-wash" />
      <div className="sk-wrap">
        <span className="sk-eyebrow">Live · 19 specialists · MIT</span>
        <h1 className="sk-h1">
          Your engineering team,<br /><em>on the call.</em>
        </h1>
        <p className="sk-sub">
          Every gstack specialist — CEO, CSO, QA Lead, Senior Designer, SRE — joins your
          Google Meet as a real voice bot with its own 3D avatar. Powered by your coding-agent
          session. Free forever, open source, no SaaS lock-in.
        </p>
        <div className="sk-cta-row">
          <Link href="/" className="sk-btn sk-btn-lime">
            Try now <Arrow />
          </Link>
          <a href="https://github.com/pattern-ai-labs/gstack-joins-meeting" target="_blank" rel="noopener noreferrer" className="sk-btn sk-btn-outline">
            Star on GitHub <Arrow />
          </a>
        </div>
        <div className="sk-meta">
          <span><b>Surface</b> Cream paper</span>
          <span><b>Accent</b> Electric lime</span>
          <span><b>Signature</b> Ink stamp</span>
        </div>
      </div>
    </section>
  );
}

function Ribbon() {
  return (
    <section className="sk-ribbon">
      <div className="sk-wrap sk-ribbon-inner">
        <span className="sk-ribbon-prefix">Built on</span>
        <a href="https://github.com/garrytan/gstack" target="_blank" rel="noopener noreferrer" className="sk-chip">
          <span className="sk-chip-mark" style={{ background: "#ff6b2b", color: "#fff" }}>G</span>
          <span><strong>gstack</strong> <em>by @garrytan</em></span>
        </a>
        <span className="sk-ribbon-plus">+</span>
        <a href="https://agentcall.dev" target="_blank" rel="noopener noreferrer" className="sk-chip">
          <span className="sk-chip-mark sk-chip-lime">A</span>
          <span><strong>AgentCall</strong> <em>by Pattern AI Labs</em></span>
        </a>
        <span className="sk-ribbon-suffix">— thank you both.</span>
      </div>
    </section>
  );
}

function Roster() {
  const row = [...SPECIALISTS, ...SPECIALISTS];
  return (
    <section className="sk-block">
      <div className="sk-wrap sk-center">
        <span className="sk-sec-num">01</span>
        <h2 className="sk-h2">19 specialists. <em>One paste.</em></h2>
        <p className="sk-desc">Every persona from Garry Tan's gstack — adapted to a real voice agent with its own voice and avatar.</p>
      </div>
      <div className="sk-marquee-wrap">
        <div className="sk-marquee">
          {row.map((s, i) => (
            <div key={`${s.id}-${i}`} className="sk-spec-card">
              <span className="sk-spec-glyph">{s.glyph}</span>
              <div>
                <div className="sk-spec-name">{s.name}</div>
                <div className="sk-spec-role">{s.role}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function How() {
  return (
    <section className="sk-block" id="how">
      <div className="sk-wrap sk-center">
        <span className="sk-sec-num">02</span>
        <h2 className="sk-h2">Three steps. <em>No magic.</em></h2>
      </div>
      <div className="sk-wrap sk-grid-3">
        <Step n="1" t="Run a brain" b="One-line install. Your coding-agent session (Claude Code, Codex, Cursor) becomes the brain." />
        <Step n="2" t="Paste a Meet URL" b="Pick the specialists you want — solo or a curated team like Founding or QA & Ship." />
        <Step n="3" t="Bots join, in character" b="Each specialist joins as a participant with a unique avatar and voice. Listen, respond, recall." />
      </div>
    </section>
  );
}

function Step({ n, t, b }: { n: string; t: string; b: string }) {
  return (
    <div className="sk-step">
      <div className="sk-step-n">{n}</div>
      <div className="sk-step-t">{t}</div>
      <div className="sk-step-b">{b}</div>
    </div>
  );
}

function Install() {
  return (
    <section className="sk-block" id="install">
      <div className="sk-wrap sk-center">
        <span className="sk-sec-num">03</span>
        <h2 className="sk-h2">Install. Mint a key. <em>Dispatch.</em></h2>
      </div>
      <div className="sk-wrap" style={{ maxWidth: 760 }}>
        <div className="sk-codechip">
          <code>
            <span className="sk-mono-mute"># clone + register as a Claude Code skill</span>{"\n"}
            curl -fsSL https://raw.githubusercontent.com/pattern-ai-labs/gstack-joins-meeting/main/install | bash
          </code>
        </div>
        <p className="sk-install-foot">
          Then in your agent: <code className="sk-mono">"Bring the CEO into this meeting: &lt;url&gt;"</code>
        </p>
      </div>
    </section>
  );
}

function Thanks() {
  return (
    <section className="sk-block sk-thanks">
      <div className="sk-wrap sk-center">
        <div className="sk-bow">🙏</div>
        <h2 className="sk-h2">Thanks, <em>Garry.</em></h2>
        <p className="sk-desc">
          This project would not exist without <strong>Garry Tan</strong> open-sourcing{" "}
          <a href="https://github.com/garrytan/gstack" target="_blank" rel="noopener noreferrer">gstack</a>.
          Every specialist on this page — how they ask questions, what they refuse to soften, the rhythm of their feedback —
          is his work. We just bridged it to a meeting tile.
        </p>
        <div className="sk-cta-row sk-center-row">
          <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent("just shipped gstack-joins-meeting — turns @garrytan's gstack specialists into real voice bots that join your Google Meet. open source, MIT. thanks Garry for shipping the personas. https://gstack-joins-meeting.vercel.app/landing/v2")}`} target="_blank" rel="noopener noreferrer" className="sk-btn sk-btn-lime">Share on X <Arrow /></a>
          <a href="https://github.com/garrytan/gstack" target="_blank" rel="noopener noreferrer" className="sk-btn sk-btn-outline">Star garrytan/gstack <Arrow /></a>
          <a href="https://x.com/garrytan" target="_blank" rel="noopener noreferrer" className="sk-btn sk-btn-outline">Follow @garrytan <Arrow /></a>
        </div>
      </div>
    </section>
  );
}

function Foot() {
  return (
    <footer className="sk-foot">
      <div className="sk-wrap sk-foot-inner">
        <span className="sk-mono-mute">© 2026 · gstack-joins-meeting · MIT · made with ♡ for the YC ecosystem</span>
        <Link href="/landing" className="sk-foot-link">← back to v1</Link>
      </div>
    </footer>
  );
}

function Arrow() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: "rotate(-3deg)" }}><path d="M5 12h13M13 6l6 6-6 6"/></svg>;
}

const styles = `
.sk {
  --sk-bg: #f3f0e8; --sk-bg-2: #eceae0; --sk-card: #fff; --sk-dark: #0e0f0d;
  --sk-ink: #0c0d0a; --sk-muted: #6c6a60; --sk-line: #d8d3c4;
  --sk-lime: #c8ff3a; --sk-lime-soft: #e6fa8a; --sk-ink-on-lime: #0a0b07;
  --sk-sans: 'Inter', system-ui, sans-serif;
  --sk-serif: 'Instrument Serif', 'Times New Roman', serif;
  --sk-mono: 'JetBrains Mono', ui-monospace, monospace;
  --sk-stamp: 5px 5px 0 var(--sk-ink);
  --sk-stamp-sm: 3px 3px 0 var(--sk-ink);
  --sk-stamp-lg: 8px 8px 0 var(--sk-ink);
  --sk-ease: cubic-bezier(.2,.7,.2,1);

  margin-left: calc(-1 * var(--gutter, 0)); /* unused — full bleed expected */
  background: var(--sk-bg);
  color: var(--sk-ink);
  font-family: var(--sk-sans);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
.sk * { box-sizing: border-box; }
.sk-wrap { max-width: 1120px; margin: 0 auto; padding: 0 32px; }
.sk-center { text-align: center; }

/* topbar */
.sk-topbar { position: sticky; top: 0; z-index: 50; background: color-mix(in srgb, var(--sk-bg) 88%, transparent); backdrop-filter: blur(8px); border-bottom: 1px solid var(--sk-line); }
.sk-topbar-inner { display: flex; align-items: center; justify-content: space-between; height: 64px; gap: 16px; }
.sk-brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: var(--sk-ink); font-size: 15px; }
.sk-brand em { font-family: var(--sk-mono); font-size: 11px; color: var(--sk-muted); margin-left: 4px; font-style: normal; }
.sk-mark { width: 28px; height: 28px; background: var(--sk-lime); color: var(--sk-ink-on-lime); border: 1.5px solid var(--sk-ink); border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; box-shadow: 3px 3px 0 var(--sk-ink); }
.sk-nav { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.sk-nav a:not(.sk-btn) { font-family: var(--sk-mono); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .1em; color: var(--sk-muted); text-decoration: none; padding: 7px 10px; border-radius: 8px; }
.sk-nav a:not(.sk-btn):hover { color: var(--sk-ink); background: var(--sk-bg-2); }

/* cover */
.sk-cover { padding: 84px 0 64px; position: relative; overflow: hidden; }
.sk-cover-wash { position: absolute; inset: 0; background: radial-gradient(70% 70% at 82% 10%, rgba(200,255,58,.22), transparent 62%); }
.sk-cover .sk-wrap { position: relative; z-index: 2; }
.sk-eyebrow { display: inline-flex; align-items: center; gap: 7px; background: var(--sk-lime); color: var(--sk-ink-on-lime); border: 1.5px solid var(--sk-ink); border-radius: 999px; padding: 6px 13px; font-family: var(--sk-mono); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .14em; box-shadow: 3px 3px 0 var(--sk-ink); }
.sk-h1 { font-family: var(--sk-sans); font-weight: 700; font-size: clamp(44px, 7vw, 86px); letter-spacing: -.04em; line-height: 1; margin: 24px 0 0; }
.sk-h1 em { font-family: var(--sk-serif); font-style: italic; font-weight: 400; }
.sk-sub { font-size: clamp(17px, 1.8vw, 21px); color: var(--sk-muted); letter-spacing: -.012em; max-width: 640px; margin: 22px 0 0; line-height: 1.45; }
.sk-cta-row { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 30px; }
.sk-center-row { justify-content: center; }
.sk-meta { display: flex; gap: 26px; flex-wrap: wrap; margin-top: 30px; font-family: var(--sk-mono); font-size: 12px; color: var(--sk-muted); }
.sk-meta b { color: var(--sk-ink); font-weight: 600; }

/* btn */
.sk-btn { display: inline-flex; align-items: center; gap: 8px; font-family: var(--sk-sans); font-weight: 600; font-size: 14px; border-radius: 999px; padding: 12px 20px; cursor: pointer; text-decoration: none; border: 2px solid var(--sk-ink); box-shadow: var(--sk-stamp); transition: transform .2s var(--sk-ease), box-shadow .2s var(--sk-ease); white-space: nowrap; }
.sk-btn:hover { transform: translate(-2px, -2px); box-shadow: var(--sk-stamp-lg); }
.sk-btn-lime { background: var(--sk-lime); color: var(--sk-ink-on-lime); }
.sk-btn-outline { background: transparent; color: var(--sk-ink); }

/* ribbon */
.sk-ribbon { background: var(--sk-bg-2); border-top: 1px solid var(--sk-line); border-bottom: 1px solid var(--sk-line); }
.sk-ribbon-inner { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 12px; padding: 18px 32px; font-size: 13.5px; color: var(--sk-muted); }
.sk-ribbon-prefix, .sk-ribbon-plus, .sk-ribbon-suffix { color: var(--sk-muted); }
.sk-chip { display: inline-flex; align-items: center; gap: 8px; background: var(--sk-card); color: var(--sk-ink); border: 1.5px solid var(--sk-ink); border-radius: 999px; padding: 6px 14px; box-shadow: 3px 3px 0 var(--sk-ink); text-decoration: none; transition: transform .15s var(--sk-ease); font-size: 13px; }
.sk-chip:hover { transform: translate(-1px, -1px); }
.sk-chip strong { font-weight: 700; }
.sk-chip em { font-family: var(--sk-mono); font-style: normal; color: var(--sk-muted); font-size: 11px; margin-left: 4px; }
.sk-chip-mark { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; border: 1px solid var(--sk-ink); }
.sk-chip-lime { background: var(--sk-lime); color: var(--sk-ink-on-lime); }

/* sections */
.sk-block { padding: 72px 0; border-top: 1px solid var(--sk-line); }
.sk-sec-num { font-family: var(--sk-mono); font-size: 11px; font-weight: 600; color: var(--sk-ink-on-lime); background: var(--sk-lime); border: 1.5px solid var(--sk-ink); border-radius: 6px; padding: 3px 9px; display: inline-block; margin-bottom: 14px; }
.sk-h2 { font-family: var(--sk-sans); font-weight: 700; font-size: clamp(30px, 4.5vw, 52px); letter-spacing: -.03em; line-height: 1.04; margin: 0; }
.sk-h2 em { font-family: var(--sk-serif); font-style: italic; font-weight: 400; }
.sk-desc { font-size: 16px; color: var(--sk-muted); max-width: 600px; margin: 14px auto 0; line-height: 1.5; }

/* roster */
.sk-marquee-wrap { margin-top: 38px; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 8%, #000 92%, transparent 100%); mask-image: linear-gradient(90deg, transparent 0%, #000 8%, #000 92%, transparent 100%); }
.sk-marquee { display: flex; gap: 14px; width: max-content; animation: sk-marquee 60s linear infinite; }
.sk-marquee:hover { animation-play-state: paused; }
@keyframes sk-marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
.sk-spec-card { display: inline-flex; align-items: center; gap: 12px; background: var(--sk-card); border: 2px solid var(--sk-ink); border-radius: 14px; padding: 12px 16px; box-shadow: var(--sk-stamp-sm); min-width: 220px; }
.sk-spec-glyph { width: 36px; height: 36px; border-radius: 50%; background: var(--sk-bg-2); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; border: 1.5px solid var(--sk-ink); flex-shrink: 0; }
.sk-spec-name { font-weight: 600; font-size: 13.5px; }
.sk-spec-role { font-family: var(--sk-mono); font-size: 10.5px; color: var(--sk-muted); text-transform: uppercase; letter-spacing: .08em; margin-top: 2px; }

/* how */
.sk-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; margin-top: 40px; }
@media (max-width: 780px) { .sk-grid-3 { grid-template-columns: 1fr; } }
.sk-step { background: var(--sk-card); border: 2px solid var(--sk-ink); border-radius: 18px; padding: 26px 24px; box-shadow: var(--sk-stamp); position: relative; }
.sk-step-n { font-family: var(--sk-serif); font-style: italic; font-size: 48px; line-height: 1; color: var(--sk-lime); -webkit-text-stroke: 1.5px var(--sk-ink); position: absolute; top: 16px; right: 22px; }
.sk-step-t { font-weight: 700; font-size: 19px; letter-spacing: -.015em; }
.sk-step-b { font-size: 14px; color: var(--sk-muted); line-height: 1.55; margin-top: 8px; max-width: 90%; }

/* install */
.sk-codechip { margin-top: 34px; background: var(--sk-bg-2); border: 1.5px dashed var(--sk-ink); border-radius: 14px; padding: 18px 22px; font-family: var(--sk-mono); font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
.sk-codechip code { font-family: var(--sk-mono); }
.sk-mono { font-family: var(--sk-mono); background: var(--sk-bg-2); padding: 2px 6px; border-radius: 6px; font-size: 13px; }
.sk-mono-mute { color: var(--sk-muted); }
.sk-install-foot { margin-top: 16px; font-size: 14px; color: var(--sk-muted); text-align: center; }

/* thanks */
.sk-thanks { background: var(--sk-bg-2); }
.sk-bow { font-size: 56px; margin-bottom: 8px; }

/* foot */
.sk-foot { background: var(--sk-dark); color: var(--sk-bg); padding: 32px 0; margin-top: 0; }
.sk-foot-inner { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; font-family: var(--sk-mono); font-size: 11.5px; color: #9a988e; }
.sk-foot-link { color: #9a988e; text-decoration: none; }
.sk-foot-link:hover { color: #fff; }
`;
