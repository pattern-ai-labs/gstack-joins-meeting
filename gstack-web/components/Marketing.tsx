"use client";
import Link from "next/link";
import { SignInButton, SignedIn, SignedOut } from "@/lib/auth";
import { isDevAuth } from "@/lib/auth-mode";

const TEAM_SAMPLE = [
  { glyph: "♛", role: "CEO",              accent: "#ffb020" },
  { glyph: "⎇", role: "Eng Manager",      accent: "#5ee1b5" },
  { glyph: "⛨", role: "CSO",              accent: "#f87171" },
  { glyph: "◐", role: "Designer Who Codes", accent: "#f472b6" },
  { glyph: "⌘", role: "Staff Engineer",   accent: "#00e5ff" },
  { glyph: "§", role: "Spec Partner",     accent: "#a3e635" },
];

export function Marketing() {
  return (
    <div className="max-w-5xl mx-auto px-8 py-20 anim-fade">
      <div className="text-center mb-16">
        <div className="inline-flex items-center gap-2 chip mb-6 anim-up">
          <span className="dot dot-ok pulse" />
          <span className="mono">19 specialists ready · 6 team presets</span>
        </div>

        <h1 className="text-[56px] font-semibold leading-[1.05] tracking-tight anim-up" style={{ animationDelay: "60ms" }}>
          Bring your <span className="gradient-text">engineering team</span><br/>
          into the meeting.
        </h1>
        <p className="text-[17px] text-[var(--color-fg-soft)] mt-5 max-w-xl mx-auto leading-relaxed anim-up" style={{ animationDelay: "120ms" }}>
          Every gstack specialist — CEO, CSO, QA Lead, Senior Designer, SRE — joins your Google Meet
          as a real voice bot with its own avatar. Powered by your Claude Code session.
        </p>

        <div className="flex items-center justify-center gap-3 mt-10 anim-up" style={{ animationDelay: "180ms" }}>
          <SignedOut>
            {isDevAuth() ? (
              <Link href="/" className="btn btn-primary px-6 py-3 text-[14px]">
                Enter dashboard →
              </Link>
            ) : (
              <SignInButton mode="modal">
                <button className="btn btn-primary px-6 py-3 text-[14px]">Sign in to dispatch →</button>
              </SignInButton>
            )}
          </SignedOut>
          <SignedIn>
            <Link href="/" className="btn btn-primary px-6 py-3 text-[14px]">Open dashboard →</Link>
          </SignedIn>
          <a href="https://github.com/pattern-ai-labs/gstack-joins-meeting" target="_blank" rel="noopener" className="btn btn-outline px-5 py-3 text-[13px]">
            View on GitHub
          </a>
        </div>

        <div className="mt-16 flex justify-center gap-3 flex-wrap anim-up" style={{ animationDelay: "240ms" }}>
          {TEAM_SAMPLE.map((m, i) => (
            <div
              key={m.role}
              className="card flex items-center gap-2 px-3 py-2"
              style={{ animationDelay: `${280 + i * 40}ms` }}
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold"
                style={{
                  background: `${m.accent}22`, color: m.accent,
                  boxShadow: `inset 0 0 0 1px ${m.accent}44`,
                }}
              >
                {m.glyph}
              </span>
              <span className="text-[12.5px]">{m.role}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Feature
          title="Paste & dispatch"
          body="Drop a Meet URL, click the specialists you want, hit dispatch. Each bot joins with a unique avatar and voice."
        />
        <Feature
          title="Your Claude is the brain"
          body="Bots have no LLM. Your Claude Code session reads the meeting transcript and writes replies in character — through your subscription."
        />
        <Feature
          title="Bring your own machine"
          body="A worker daemon on your laptop runs the dispatch. No SaaS lock-in. Free until you outgrow your AgentCall tier."
        />
      </div>

      <div className="text-center mt-14 mono text-[11px] text-[var(--color-muted)]">
        Open source · MIT · stdlib Python on the backend
      </div>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="card card-hover">
      <div className="font-semibold text-[14px]">{title}</div>
      <div className="text-[13px] text-[var(--color-fg-soft)] mt-2 leading-snug">{body}</div>
    </div>
  );
}
