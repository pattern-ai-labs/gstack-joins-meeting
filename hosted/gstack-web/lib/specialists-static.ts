// Static specialist roster for the MARKETING surface (landing page).
//
// The live dashboard reads /api/specialists (auth-gated, applies per-tenant
// overrides). But the landing renders for signed-out visitors, so it can't
// hit that endpoint. This module is a public, build-time copy of the roster
// mirrored from data/specialists.json — plus a hand-written `whenToCall`
// line per persona so a visitor clicking a specialist gets a real narrative
// (what it does, how it helps, when to reach for it) instead of a dead link.
//
// Keep `id`, `name`, `role`, `accent`, `glyph`, `category`, `blurb` in sync
// with data/specialists.json. `whenToCall` lives only here.

export type MarketingSpecialist = {
  id: string;
  name: string;
  role: string;
  category: string;
  accent: string;
  glyph: string;
  voice: string;
  blurb: string;       // first-person "what I do" (from description)
  whenToCall: string;  // "reach for this when…"
};

export const SPECIALISTS: MarketingSpecialist[] = [
  {
    id: "office-hours", name: "YC Office Hours", role: "YC Office Hours partner",
    category: "Strategy", accent: "#ff6b2b", glyph: "◉", voice: "am_michael",
    blurb: "I grill founders on traction, users, and why-now — YC-style, no softball.",
    whenToCall: "Before a raise or launch, when your traction story needs holes poked in it.",
  },
  {
    id: "plan-ceo-review", name: "CEO", role: "CEO",
    category: "Strategy", accent: "#ffb020", glyph: "♛", voice: "am_adam",
    blurb: "I pressure-test the strategy — is this the right bet, right now, for this team.",
    whenToCall: "When you're deciding whether to build something at all — the strategic go/no-go.",
  },
  {
    id: "plan-eng-review", name: "Eng Manager", role: "Engineering Manager",
    category: "Planning", accent: "#5ee1b5", glyph: "⎇", voice: "bm_george",
    blurb: "I lock architecture before a line is written — boundaries, blast radius, and the rewrite path.",
    whenToCall: "At the start of a feature, before code — to set boundaries and dodge a rewrite.",
  },
  {
    id: "plan-design-review", name: "Senior Designer", role: "Senior Designer",
    category: "Planning", accent: "#d68cff", glyph: "◈", voice: "af_sarah",
    blurb: "I score the plan against a gold-standard product — hierarchy, density, flow.",
    whenToCall: "When a design plan needs scoring against a gold-standard bar before you commit.",
  },
  {
    id: "plan-devex-review", name: "DX Lead", role: "Developer Experience Lead",
    category: "Planning", accent: "#7dd3fc", glyph: "❮❯", voice: "bf_emma",
    blurb: "I plan the developer experience — first-run, docs, and the time from clone to ship.",
    whenToCall: "When you're planning onboarding, docs, or the first-run path for your users.",
  },
  {
    id: "design-consultation", name: "Design Partner", role: "Design Partner",
    category: "Design", accent: "#f0abfc", glyph: "✦", voice: "bf_isabella",
    blurb: "I set the design system direction and review every product surface end to end.",
    whenToCall: "When you need one coherent design-system direction across the whole product.",
  },
  {
    id: "design-shotgun", name: "Design Explorer", role: "Design Explorer",
    category: "Design", accent: "#fb7185", glyph: "⁂", voice: "af_nicole",
    blurb: "I generate six mockup variants in parallel so we can compare instead of debate.",
    whenToCall: "Early in design, when you want real options to compare instead of arguing over one.",
  },
  {
    id: "design-html", name: "Design Engineer", role: "Design Engineer",
    category: "Design", accent: "#a78bfa", glyph: "</>", voice: "am_michael",
    blurb: "I hand-code production HTML from a spec — semantic, accessible, no framework bloat.",
    whenToCall: "When a spec needs to become real, accessible, framework-free HTML.",
  },
  {
    id: "review", name: "Staff Engineer", role: "Staff Engineer",
    category: "Engineering", accent: "#00e5ff", glyph: "⌘", voice: "bm_lewis",
    blurb: "I read every line of the diff and catch the two things you missed.",
    whenToCall: "Before you merge — to catch the bugs a quick self-review skips past.",
  },
  {
    id: "investigate", name: "Debugger", role: "Debugger",
    category: "Engineering", accent: "#fde047", glyph: "⌕", voice: "am_adam",
    blurb: "I root-cause bugs — hypothesis, evidence, fix. No guessing.",
    whenToCall: "When something's broken and you need a root cause, not a guess.",
  },
  {
    id: "design-review", name: "Designer Who Codes", role: "Designer Who Codes",
    category: "Review", accent: "#f472b6", glyph: "◐", voice: "af_bella",
    blurb: "I audit the live UI against the rubric — what shipped, not what's in the mockup.",
    whenToCall: "After a UI ships — to audit what's actually live against the design intent.",
  },
  {
    id: "devex-review", name: "DX Tester", role: "Developer Experience Tester",
    category: "Review", accent: "#60a5fa", glyph: "▤", voice: "bf_emma",
    blurb: "I clone, run, and feel the product — I log every second of friction.",
    whenToCall: "When you want fresh hands to clone, run, and log every friction point.",
  },
  {
    id: "qa", name: "QA Lead", role: "QA Lead",
    category: "Quality", accent: "#4ade80", glyph: "✓", voice: "af_sarah",
    blurb: "I write tests, run them, and fix what breaks — every bug gets a regression.",
    whenToCall: "When a change needs real tests and regressions, not just a manual click-through.",
  },
  {
    id: "cso", name: "CSO", role: "Chief Security Officer",
    category: "Quality", accent: "#f87171", glyph: "⛨", voice: "am_michael",
    blurb: "I run OWASP Top Ten and STRIDE threat models — I find the exploits that ship to prod.",
    whenToCall: "Before shipping anything that touches auth, data, or untrusted input.",
  },
  {
    id: "ship", name: "Release Engineer", role: "Release Engineer",
    category: "Release", accent: "#34d399", glyph: "▲", voice: "bm_george",
    blurb: "I open the PR with a real description and the right reviewers — ship small, ship often.",
    whenToCall: "When the work is done and the PR needs to go out clean and reviewable.",
  },
  {
    id: "land-and-deploy", name: "Deploy Engineer", role: "Deploy Engineer",
    category: "Release", accent: "#22d3ee", glyph: "⇧", voice: "bm_lewis",
    blurb: "I merge, deploy, and verify the new bits are actually live before I clock out.",
    whenToCall: "When you need the merge deployed and verified actually live, not assumed.",
  },
  {
    id: "canary", name: "SRE", role: "Site Reliability Engineer",
    category: "Release", accent: "#fbbf24", glyph: "☀", voice: "am_adam",
    blurb: "I watch logs and metrics after every deploy — any error-budget burn and I roll back fast.",
    whenToCall: "Right after a deploy — to watch metrics and roll back fast if it burns.",
  },
  {
    id: "retro", name: "Retro Facilitator", role: "Retrospective Facilitator",
    category: "Ops", accent: "#c4b5fd", glyph: "↻", voice: "bm_george",
    blurb: "I run the weekly retro — what shipped, what slipped, what we'd do different.",
    whenToCall: "End of a sprint or cycle — to capture what shipped and what slipped.",
  },
  {
    id: "spec", name: "Spec Partner", role: "Spec Authoring Partner",
    category: "Planning", accent: "#a3e635", glyph: "§", voice: "bf_isabella",
    blurb: "I turn vague intent into a precise, executable spec — five phases: why, scope, technical, draft, file.",
    whenToCall: "When intent is vague and you need a backlog-ready spec before anyone builds.",
  },
];

// Kokoro voice id (e.g. "am_adam") → friendly first name for the UI.
export function voiceLabel(voice: string): string {
  const n = voice.split("_")[1] || voice;
  return n.charAt(0).toUpperCase() + n.slice(1);
}
