export type User = {
  id: string;
  email?: string;
  display_name?: string;
  role: "admin" | "member";
  plan: string;
  quota_minutes: number;
  minutes_used: number;
};

export type Worker = {
  id: string;
  owner_user_id?: string;
  name: string;
  platform: string;
  state: "idle" | "busy";
  connected_at: number;
  last_assignment_id?: string | null;
  last_assignment_at?: number | null;
};

export type Specialist = {
  id: string;
  name: string;
  card_name: string;
  role: string;
  description: string;
  desc_card: string;
  voice: string;
  icon: string;
  glyph: string;
  accent: string;
  category: string;
};

export type Assignment = {
  id: string;
  user_id: string;
  worker_id?: string;
  meet_url: string;
  specialists: string[];
  brief?: string;
  mode: string;
  status: "started" | "ended" | "failed" | "rejected" | "cancelled" | "pending" | "queued";
  detail?: unknown;
  created_at?: string;
  dispatched_at?: string;
  ended_at?: string;
  billable_seconds?: number;
  summary?: string | null;
  queue_position?: number | null;
  progress?: { stage: string; joined: string[] };
};

export type TranscriptEntry = {
  seq: number;
  kind: "user" | "bot";
  speaker: string;
  specialist_id: string;
  text: string;
  ts: number;
};

export type TranscriptResponse = {
  entries: TranscriptEntry[];
  stage?: string | null;
  joined: string[];
  status: Assignment["status"];
  summary?: string | null;
};

export type WorkerKey = {
  key_hash_prefix: string;
  owner_user_id: string;
  label: string;
  created_at?: string;
  last_seen_at?: string;
  revoked: boolean;
};
