"use client";
import { useState } from "react";
import Link from "next/link";
import { SignInButton, SignedIn, SignedOut } from "@/lib/auth";
import { isDevAuth } from "@/lib/auth-mode";
import { SPECIALISTS, type MarketingSpecialist } from "@/lib/specialists-static";
import { SpecialistDetailModal } from "./SpecialistDetailModal";

export function Marketing() {
  return (
    <div className="w-full anim-fade">
      <Topbar />
      <Hero />
      <HowItWorks />
      <SpecialistGrid />
      <InstallBlock />
      <WhyExists />
      <ThanksGarry />
      <Footer />
    </div>
  );
}

/* ─── topbar ─────────────────────────────────────────────────────────── */

function Topbar() {
  return (
    <header className="sticky top-0 z-40 glass border-b border-[var(--color-border)]">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* topbar lockup — variant D at DOM scale: lime gstack, orange ✕,
            cream agentcall. The full SVG (with tagline) stays in the footer;
            shrunk to 28px the tagline would be mush, so the topbar gets the
            wordmark row rebuilt in text. */}
        <Link href="/" className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[var(--color-accent)] text-[var(--color-accent-fg)] flex items-center justify-center font-bold text-sm mr-0.5">G</span>
          <span className="text-[15px] font-semibold tracking-tight text-[var(--color-accent)]">gstack</span>
          <span className="text-[12px] font-bold" style={{ color: "#ff6b2b" }}>✕</span>
          <span className="text-[15px] font-semibold tracking-tight" style={{ color: "#f4eedd" }}>agentcall</span>
        </Link>
        <nav className="flex items-center gap-2 text-[13px]">
          <a href="#how" className="hidden sm:inline px-3 py-1.5 text-[var(--color-fg-soft)] hover:text-[var(--color-fg)]">How it works</a>
          <a href="#install" className="hidden sm:inline px-3 py-1.5 text-[var(--color-fg-soft)] hover:text-[var(--color-fg)]">Install</a>
          <a
            href="https://github.com/pattern-ai-labs/gstack-joins-meeting"
            target="_blank" rel="noopener noreferrer"
            className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 text-[var(--color-fg-soft)] hover:text-[var(--color-fg)]"
          >
            <GhIcon className="w-4 h-4" /> GitHub
          </a>
          <TryNowButton small />
        </nav>
      </div>
    </header>
  );
}

/* ─── hero ──────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <BackgroundGlow />
      <div className="max-w-5xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 chip mb-7 anim-up">
          <span className="dot dot-ok pulse" />
          <span className="mono text-[11px]">live · 19 specialists · 6 team presets · MIT</span>
        </div>

        <h1 className="text-[64px] sm:text-[88px] leading-[0.95] tracking-[-0.04em] font-semibold anim-up" style={{ animationDelay: "60ms" }}>
          <span className="gradient-text">gstack</span> joins<br/>your meeting.
        </h1>

        {/* Two blocks instead of a forced <br>: the lead-in wraps with
            text-balance into even lines, the verb clause sits alone in
            full-strength white. A hard break inside flowing text fought
            the natural wrap and orphaned a stubby middle line. */}
        <p className="text-[17px] sm:text-[19px] text-[var(--color-fg-soft)] max-w-2xl mx-auto mt-7 leading-relaxed anim-up" style={{ animationDelay: "140ms" }}>
          <span className="block text-balance">
            <a
              href="https://github.com/garrytan/gstack"
              target="_blank" rel="noopener noreferrer"
              className="text-[var(--color-accent)] underline underline-offset-4 decoration-[var(--color-accent-ring)]"
            >Garry Tan's gstack</a>
            {" "}specialists — CEO, CSO, QA Lead and 16 more — sit in your meeting like real teammates:
          </span>
          <span className="block mt-1.5 text-[var(--color-fg)] text-balance">
            they question the plan, validate the direction, and push you to ship.
          </span>
        </p>

        <div className="flex items-center justify-center gap-3 mt-10 anim-up" style={{ animationDelay: "220ms" }}>
          <TryNowButton />
          <a
            href="https://github.com/pattern-ai-labs/gstack-joins-meeting"
            target="_blank" rel="noopener noreferrer"
            className="btn btn-outline px-5 py-3 text-[13px]"
          >
            <GhIcon className="w-4 h-4 mr-1" /> Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

function TryNowButton({ small = false }: { small?: boolean }) {
  const cls = small
    ? "btn btn-primary px-3.5 py-1.5 text-[12px]"
    : "btn btn-primary px-7 py-3.5 text-[14px]";
  return (
    <>
      <SignedIn>
        <Link href="/" className={cls}>Open dashboard →</Link>
      </SignedIn>
      <SignedOut>
        {isDevAuth() ? (
          <Link href="/" className={cls}>Try now →</Link>
        ) : (
          <SignInButton mode="modal">
            <button className={cls}>Try now →</button>
          </SignInButton>
        )}
      </SignedOut>
    </>
  );
}

function BackgroundGlow() {
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none">
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full opacity-[0.18]"
           style={{ background: "radial-gradient(circle, var(--color-accent) 0%, transparent 60%)" }} />
      <div className="absolute top-32 -left-32 w-[400px] h-[400px] rounded-full opacity-[0.10]"
           style={{ background: "radial-gradient(circle, #60a5fa 0%, transparent 60%)" }} />
      <div className="absolute -bottom-20 -right-20 w-[400px] h-[400px] rounded-full opacity-[0.10]"
           style={{ background: "radial-gradient(circle, #f472b6 0%, transparent 60%)" }} />
    </div>
  );
}

/* ─── specialist grid (replaces Showcase + Marquee) ───────────────
 * Per user feedback: the old "dashboard your team will use" product
 * screenshot was long and not the most compelling visual. People want
 * to SEE the cast first — who shows up, what they do. The grid below
 * mirrors the dashboard's Specialists section.
 *
 * Clicking a tile used to open github.com/garrytan/gstack/blob/main/<id>.md,
 * which 404s (those ids aren't real filenames in his repo). Now each tile
 * opens a SpecialistDetailModal with the persona narrative — what it does,
 * when to call it, its voice — sourced from lib/specialists-static.ts so
 * the signed-out landing needs no auth-gated API call. */
function SpecialistGrid() {
  const [selected, setSelected] = useState<MarketingSpecialist | null>(null);
  return (
    <section className="py-20 border-t border-[var(--color-border)]">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-10">
          <div className="label-cap mb-3">The roster</div>
          <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-tight">
            19 specialists. One paste.
          </h2>
          <p className="text-[14px] text-[var(--color-fg-soft)] mt-3 max-w-xl mx-auto">
            Every specialist from{" "}
            <a
              href="https://github.com/garrytan/gstack"
              target="_blank" rel="noopener noreferrer"
              className="text-[var(--color-accent)] underline underline-offset-4"
            >Garry Tan's gstack</a>
            {" "}— adapted to a real voice agent. Tap any one to see what it does.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {SPECIALISTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected(s)}
              className="surface p-4 flex items-center gap-3 hover:bg-[var(--color-panel-2)] transition group text-left"
              title={`${s.name} — ${s.role}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/avatars/${s.id}.svg`}
                alt=""
                width={40} height={40}
                className="w-10 h-10 rounded-full shrink-0"
                style={{ boxShadow: `inset 0 0 0 1px ${s.accent}55` }}
                loading="lazy"
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[13px] truncate">{s.name}</div>
                <div className="text-[11px] text-[var(--color-muted)] truncate">{s.role}</div>
              </div>
              <span className="text-[var(--color-muted)] group-hover:text-[var(--color-fg)] text-[13px] opacity-0 group-hover:opacity-100 transition">→</span>
            </button>
          ))}
        </div>
      </div>

      <SpecialistDetailModal specialist={selected} onClose={() => setSelected(null)} />
    </section>
  );
}

/* ─── how it works ───────────────────────────────────────────────── */

function HowItWorks() {
  return (
    <section id="how" className="py-20 border-t border-[var(--color-border)]">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="label-cap mb-3">How it works</div>
          <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-tight">Three steps. No magic.</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <Step
            num="1"
            title="Paste a Meet URL"
            body="Or hit Start one to spin up a fresh Meet in a click. Works for Google Meet, Zoom, Teams."
            kicker="any meeting"
          />
          <Step
            num="2"
            title="Pick specialists"
            body="Solo, or a curated team — Founding, Design, QA & Ship, DX. Six presets, 19 specialists."
            kicker="solo or team"
          />
          <Step
            num="3"
            title="They join in character"
            body="Each specialist appears with their own 3D avatar and voice. They listen, respond, leave when recalled."
            kicker="real meeting participants"
          />
        </div>

        {/* bring-your-brain note — the bots run on your own coding-agent
            session, so your context + data stay on your machine and our
            side burns no credits. Links to the BYOB explainer. */}
        <Link
          href="/byob"
          className="mt-5 surface px-5 py-4 flex items-start sm:items-center gap-3 hover:bg-[var(--color-panel-2)] transition group"
        >
          <span
            className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-[16px]"
            style={{ background: "var(--color-accent-soft)" }}
          >🧠</span>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-medium">
              Bring your own brain
              <span className="text-[var(--color-muted)] font-normal"> — your coding-agent session powers the bots.</span>
            </div>
            <div className="text-[12.5px] text-[var(--color-fg-soft)] mt-0.5">
              Your context and data stay in your session, on your machine. No credits burned on our side.
            </div>
          </div>
          <span className="text-[var(--color-muted)] group-hover:text-[var(--color-fg)] text-[13px] shrink-0">→</span>
        </Link>
      </div>
    </section>
  );
}

function Step({ num, title, body, kicker }: { num: string; title: string; body: string; kicker: string }) {
  return (
    <div className="card card-hover relative overflow-hidden">
      <span className="absolute top-3 right-4 text-[64px] leading-none font-bold text-[var(--color-panel-2)] select-none">{num}</span>
      <div className="label-cap mb-2 text-[var(--color-accent)]">{kicker}</div>
      <div className="font-semibold text-[16px] mb-2">{title}</div>
      <div className="text-[13px] text-[var(--color-fg-soft)] leading-snug">{body}</div>
    </div>
  );
}

/* ─── install ────────────────────────────────────────────────────── */

function InstallBlock() {
  return (
    <section id="install" className="py-20 border-t border-[var(--color-border)]">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <div className="label-cap mb-3">60 seconds to running</div>
        <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-tight mb-6">Install. Mint a key. Dispatch.</h2>
        <div className="surface p-5 text-left bg-[var(--color-bg-soft)] anim-up">
          <div className="flex items-center justify-between mb-3 text-[11px] text-[var(--color-muted)]">
            <span className="mono">$ install gstack</span>
            <CopyBtn text='curl -fsSL https://raw.githubusercontent.com/pattern-ai-labs/gstack-joins-meeting/main/install | bash' />
          </div>
          <pre className="mono text-[13px] leading-relaxed whitespace-pre-wrap break-all text-[var(--color-fg)]">
<span className="text-[var(--color-muted)]"># clone + register as a Claude Code skill</span>{"\n"}
<span className="text-[var(--color-accent)]">curl</span> -fsSL https://raw.githubusercontent.com/pattern-ai-labs/gstack-joins-meeting/main/install <span className="text-[var(--color-fg-soft)]">|</span> bash
          </pre>
        </div>
        <p className="text-[12px] text-[var(--color-muted)] mt-3">
          Then in Claude Code: <code className="mono text-[var(--color-fg-soft)]">"Bring the CEO into this meeting: &lt;url&gt;"</code>
        </p>
      </div>
    </section>
  );
}

function CopyBtn({ text }: { text: string }) {
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).catch(() => {})}
      className="btn btn-outline text-[10px] py-1 px-2"
    >
      copy
    </button>
  );
}

/* ─── why this exists ────────────────────────────────────────────── */

function WhyExists() {
  return (
    <section className="py-20 border-t border-[var(--color-border)]">
      <div className="max-w-5xl mx-auto px-6 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <div className="label-cap mb-3">Why this exists</div>
          <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-tight mb-5 leading-[1.1]">
            gstack was already great in text.<br/>
            <span className="text-[var(--color-fg-soft)]">It belongs in your meetings too.</span>
          </h2>
          <p className="text-[14px] text-[var(--color-fg-soft)] leading-relaxed">
            Garry Tan's gstack ships 18 — now 19 — specialist personas you invoke with slash
            commands inside Claude Code. They're excellent. They were also stuck in a text terminal.
          </p>
          <p className="text-[14px] text-[var(--color-fg-soft)] leading-relaxed mt-3">
            Real product work happens in meetings: pair programming, standups, design reviews, office hours.
            The gap between <em>"I have an opinionated CEO-review prompt"</em> and <em>"the CEO is in the call right now"</em> is enormous.
            This repo closes it.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat n="19" l="specialists" />
          <Stat n="6"  l="team presets" />
          <Stat n="3"  l="modes" sub="audio · avatar · screenshare" />
          <Stat n="0"  l="LLM cost" sub="your Claude is the brain" />
        </div>
      </div>
    </section>
  );
}

function Stat({ n, l, sub }: { n: string; l: string; sub?: string }) {
  return (
    <div className="card">
      <div className="text-[40px] font-semibold tracking-tight text-[var(--color-accent)] leading-none">{n}</div>
      <div className="text-[13px] font-medium mt-2">{l}</div>
      {sub && <div className="text-[11px] text-[var(--color-muted)] mt-0.5">{sub}</div>}
    </div>
  );
}

/* ─── thanks garry ───────────────────────────────────────────────── */

function ThanksGarry() {
  // User-centric testimonial — the visitor just tried it; the tweet is
  // them sharing what they did. Frame it as "I tried X and Y happened"
  // (NOT "we just shipped"). Keeps the verb tense first-person past so
  // it works for anyone clicking the button.
  const tweet = encodeURIComponent(
    "I tried @garrytan's gstack specialists in a real Google Meet — they joined as voice bots and reviewed my startup pitch in character. Wild. https://gstack-meeting.com"
  );
  return (
    <section className="py-24 border-t border-[var(--color-border)] bg-[var(--color-bg-soft)] relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{
          background: "radial-gradient(600px 300px at 50% 100%, #ff6b2b 0%, transparent 60%)",
        }}
      />
      <div className="max-w-3xl mx-auto px-6 text-center relative">
        <div className="text-[64px] mb-3 select-none">🙏</div>
        <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-tight mb-5">Thanks, Garry.</h2>
        <p className="text-[15px] text-[var(--color-fg-soft)] leading-relaxed mb-3">
          This project would not exist without <strong className="text-[var(--color-fg)]">Garry Tan</strong> open-sourcing{" "}
          <a href="https://github.com/garrytan/gstack" target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] underline underline-offset-4">gstack</a>.
          Every specialist on this page — the way they ask questions, what they refuse to soften,
          the rhythm of their feedback — is his work. We just bridged it to a meeting tile.
        </p>
        <p className="text-[15px] text-[var(--color-fg-soft)] leading-relaxed mb-8">
          Thanks also for everything you do for the early-stage tech ecosystem — the founders you fund,
          the tools you ship, the public conversations you host. This is one developer's way of saying it back.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href={`https://twitter.com/intent/tweet?text=${tweet}`}
            target="_blank" rel="noopener noreferrer"
            className="btn btn-primary px-5 py-3 text-[13px]"
          >
            Share on X
          </a>
          <a
            href="https://github.com/garrytan/gstack"
            target="_blank" rel="noopener noreferrer"
            className="btn btn-outline px-5 py-3 text-[13px]"
          >
            <GhIcon className="w-4 h-4 mr-1.5" /> Star garrytan/gstack
          </a>
          <a
            href="https://x.com/garrytan"
            target="_blank" rel="noopener noreferrer"
            className="btn btn-outline px-5 py-3 text-[13px]"
          >
            <XIcon className="w-4 h-4 mr-1.5" /> Follow @garrytan
          </a>
        </div>
      </div>
    </section>
  );
}

/* ─── footer ─────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="py-12 border-t border-[var(--color-border)]">
      <div className="max-w-5xl mx-auto px-6 grid md:grid-cols-4 gap-8 text-[13px]">
        <div className="md:col-span-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logos/gstack-x-agentcall-lockup.svg"
            alt="gstack × agentcall — joins your meeting"
            width={570} height={115}
            className="h-12 w-auto mb-4"
          />
          <p className="text-[12px] text-[var(--color-muted)] leading-relaxed max-w-md">
            An open-source bridge from <a className="underline" href="https://github.com/garrytan/gstack" target="_blank" rel="noopener noreferrer">gstack</a> to live voice meetings via <a className="underline" href="https://agentcall.dev" target="_blank" rel="noopener noreferrer">AgentCall</a>. MIT. Built by <a className="underline" href="https://github.com/pattern-ai-labs" target="_blank" rel="noopener noreferrer">Pattern AI Labs</a>.
          </p>
        </div>
        <div>
          <div className="label-cap mb-3">Product</div>
          <ul className="space-y-1.5 text-[var(--color-fg-soft)]">
            <li><a href="#how" className="hover:text-[var(--color-fg)]">How it works</a></li>
            <li><a href="#install" className="hover:text-[var(--color-fg)]">Install</a></li>
            <li><Link href="/specialists" className="hover:text-[var(--color-fg)]">Specialists</Link></li>
            <li><TryNowLink /></li>
          </ul>
        </div>
        <div>
          <div className="label-cap mb-3">Source</div>
          <ul className="space-y-1.5 text-[var(--color-fg-soft)]">
            <li><a href="https://github.com/pattern-ai-labs/gstack-joins-meeting" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--color-fg)]">This repo</a></li>
            <li><a href="https://github.com/garrytan/gstack" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--color-fg)]">garrytan/gstack</a></li>
            <li><a href="https://agentcall.dev" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--color-fg)]">agentcall.dev</a></li>
            <li><a href="https://x.com/garrytan" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--color-fg)]">@garrytan</a></li>
          </ul>
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-6 mt-10 pt-6 border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3 text-[11px] text-[var(--color-muted)]">
        <span>MIT licensed · same license as gstack + AgentCall</span>
        <span className="mono">made with ♡ for the YC ecosystem</span>
      </div>
    </footer>
  );
}

function TryNowLink() {
  return (
    <SignedOut>
      {isDevAuth()
        ? <Link href="/" className="hover:text-[var(--color-fg)]">Try now</Link>
        : <SignInButton mode="modal"><button className="hover:text-[var(--color-fg)] text-left">Try now</button></SignInButton>}
    </SignedOut>
  );
}

/* ─── icons ──────────────────────────────────────────────────────── */

function GhIcon(p: React.SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.12c-3.19.69-3.87-1.36-3.87-1.36-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.06 11.06 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.07.78 2.16v3.2c0 .3.21.67.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/></svg>;
}
function XIcon(p: React.SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M18.244 2H21.5l-7.5 8.572L23 22h-6.832l-5.36-7.005L4.65 22H1.39l8.026-9.171L1 2h6.913l4.85 6.413L18.244 2zm-2.402 18h1.852L7.224 4H5.252l10.59 16z"/></svg>;
}
