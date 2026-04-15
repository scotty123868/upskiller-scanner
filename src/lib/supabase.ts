import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

const isConfigured = supabaseUrl !== "https://placeholder.supabase.co" && supabaseAnonKey !== "placeholder";

// Client-side Supabase (uses anon key, respects RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side Supabase (uses service role key, bypasses RLS)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export { isConfigured };

// ─── Database Schema (run this SQL in Supabase SQL editor) ───
//
// CREATE TABLE users (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   email TEXT UNIQUE NOT NULL,
//   name TEXT,
//   avatar_url TEXT,
//   provider TEXT NOT NULL DEFAULT 'google',
//   provider_id TEXT,
//   created_at TIMESTAMPTZ DEFAULT now(),
//   last_scan_at TIMESTAMPTZ,
//   scan_count INT DEFAULT 0,
//   total_waste_found TEXT DEFAULT '$0',
//   metadata JSONB DEFAULT '{}'
// );
//
// CREATE TABLE scans (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   user_id UUID REFERENCES users(id) ON DELETE CASCADE,
//   status TEXT DEFAULT 'running',
//   source TEXT DEFAULT 'google',
//   started_at TIMESTAMPTZ DEFAULT now(),
//   completed_at TIMESTAMPTZ,
//   summary JSONB DEFAULT '{}',
//   tech_stack JSONB DEFAULT '[]',
//   gaps JSONB DEFAULT '[]',
//   renewals JSONB DEFAULT '[]',
//   automations JSONB DEFAULT '[]',
//   findings_count INT DEFAULT 0,
//   total_waste TEXT,
//   coverage_score INT DEFAULT 0,
//   opus_cost_cents INT DEFAULT 0
// );
//
// CREATE TABLE findings (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
//   user_id UUID REFERENCES users(id) ON DELETE CASCADE,
//   title TEXT NOT NULL,
//   description TEXT,
//   amount TEXT,
//   severity TEXT,
//   category TEXT,
//   agent TEXT,
//   department TEXT,
//   recommendation TEXT,
//   evidence TEXT,
//   time_to_value TEXT,
//   created_at TIMESTAMPTZ DEFAULT now()
// );
//
// CREATE TABLE agent_logs (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
//   agent TEXT NOT NULL,
//   message TEXT NOT NULL,
//   log_type TEXT DEFAULT 'progress',
//   created_at TIMESTAMPTZ DEFAULT now()
// );
//
// -- Rate limiting
// CREATE TABLE rate_limits (
//   user_id UUID REFERENCES users(id) ON DELETE CASCADE,
//   month TEXT NOT NULL,
//   scan_count INT DEFAULT 0,
//   estimated_cost_cents INT DEFAULT 0,
//   PRIMARY KEY (user_id, month)
// );
//
// -- RLS policies
// ALTER TABLE users ENABLE ROW LEVEL SECURITY;
// ALTER TABLE scans ENABLE ROW LEVEL SECURITY;
// ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
// ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;
// ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
//
// -- Users can only see their own data
// CREATE POLICY "Users see own data" ON users FOR SELECT USING (true);
// CREATE POLICY "Users see own scans" ON scans FOR SELECT USING (user_id = auth.uid());
// CREATE POLICY "Users see own findings" ON findings FOR SELECT USING (user_id = auth.uid());

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  provider TEXT NOT NULL DEFAULT 'google',
  provider_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_scan_at TIMESTAMPTZ,
  scan_count INT DEFAULT 0,
  total_waste_found TEXT DEFAULT '$0',
  metadata JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'running',
  source TEXT DEFAULT 'google',
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  summary JSONB DEFAULT '{}',
  tech_stack JSONB DEFAULT '[]',
  gaps JSONB DEFAULT '[]',
  renewals JSONB DEFAULT '[]',
  automations JSONB DEFAULT '[]',
  workflows JSONB DEFAULT '[]',
  org_intelligence JSONB DEFAULT '{}',
  findings_count INT DEFAULT 0,
  total_waste TEXT,
  coverage_score INT DEFAULT 0,
  opus_cost_cents INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  amount TEXT,
  severity TEXT,
  category TEXT,
  agent TEXT,
  department TEXT,
  recommendation TEXT,
  evidence TEXT,
  time_to_value TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  message TEXT NOT NULL,
  log_type TEXT DEFAULT 'progress',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  scan_count INT DEFAULT 0,
  estimated_cost_cents INT DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
`;

// ─── Helper functions ───

export async function getOrCreateUser(email: string, name?: string, avatarUrl?: string, provider = "google") {
  if (!isConfigured) return { id: "", email, name };

  // Try to find existing user
  const { data: existing } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (existing) return existing;

  // Auto-create account
  const { data: newUser, error } = await supabaseAdmin
    .from("users")
    .insert({ email, name, avatar_url: avatarUrl, provider })
    .select()
    .single();

  if (error) throw new Error(`Failed to create user: ${error.message}`);
  return newUser;
}

export async function createScan(userId: string, source: string) {
  if (!isConfigured || !userId) return { id: "" };
  const { data, error } = await supabaseAdmin
    .from("scans")
    .insert({ user_id: userId, source })
    .select()
    .single();

  if (error) throw new Error(`Failed to create scan: ${error.message}`);
  return data;
}

export async function completeScan(scanId: string, results: {
  summary?: Record<string, unknown>; techStack?: unknown[]; gaps?: unknown[]; renewals?: unknown[];
  automations?: unknown[];
  workflows?: unknown[];
  orgIntelligence?: Record<string, unknown>;
  findingsCount?: number;
  totalWaste?: string;
  coverageScore?: number;
}) {
  if (!isConfigured || !scanId) return;
  await supabaseAdmin
    .from("scans")
    .update({
      status: "complete",
      completed_at: new Date().toISOString(),
      summary: results.summary || {},
      tech_stack: results.techStack || [],
      gaps: results.gaps || [],
      renewals: results.renewals || [],
      automations: results.automations || [],
      workflows: results.workflows || [],
      org_intelligence: results.orgIntelligence || {},
      findings_count: results.findingsCount || 0,
      total_waste: results.totalWaste,
      coverage_score: results.coverageScore || 0,
    })
    .eq("id", scanId);
}

export async function saveFinding(scanId: string, userId: string, finding: Record<string, unknown>) {
  if (!isConfigured || !scanId) return;
  await supabaseAdmin
    .from("findings")
    .insert({
      scan_id: scanId,
      user_id: userId,
      title: finding.title,
      description: finding.description,
      amount: finding.amount,
      severity: finding.severity,
      category: finding.category,
      agent: finding.agent,
      department: finding.department,
      recommendation: finding.recommendation,
      evidence: finding.evidence,
      time_to_value: finding.timeToValue,
    });
}

export async function getLatestScan(userId: string) {
  if (!isConfigured || !userId) return null;
  const { data } = await supabaseAdmin
    .from("scans")
    .select("*, findings(*)")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  return data;
}

export async function checkRateLimit(userId: string): Promise<{ allowed: boolean; scansUsed: number; costCents: number }> {
  if (!isConfigured || !userId) return { allowed: true, scansUsed: 0, costCents: 0 };
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const { data } = await supabaseAdmin
    .from("rate_limits")
    .select("*")
    .eq("user_id", userId)
    .eq("month", month)
    .single();

  if (!data) {
    // First scan this month
    return { allowed: true, scansUsed: 0, costCents: 0 };
  }

  // $10 max per user per month = 1000 cents
  // Opus scan costs ~30-80 cents per scan
  const MAX_COST_CENTS = 1000;
  return {
    allowed: data.estimated_cost_cents < MAX_COST_CENTS,
    scansUsed: data.scan_count,
    costCents: data.estimated_cost_cents,
  };
}

export async function recordScanCost(userId: string, costCents: number) {
  if (!isConfigured || !userId) return;
  const month = new Date().toISOString().slice(0, 7);

  // Try atomic increment via Postgres RPC first (race-safe).
  // Falls back to upsert + read-modify-write if the RPC doesn't exist yet.
  const { error: rpcError } = await supabaseAdmin.rpc("increment_rate_limit", {
    p_user_id: userId,
    p_month: month,
    p_cost: costCents,
  });

  if (rpcError) {
    // RPC not deployed yet — fall back to insert-or-increment
    const { data: existing } = await supabaseAdmin
      .from("rate_limits")
      .select("scan_count, estimated_cost_cents")
      .eq("user_id", userId)
      .eq("month", month)
      .single();

    if (existing) {
      await supabaseAdmin
        .from("rate_limits")
        .update({
          scan_count: existing.scan_count + 1,
          estimated_cost_cents: existing.estimated_cost_cents + costCents,
        })
        .eq("user_id", userId)
        .eq("month", month);
    } else {
      await supabaseAdmin
        .from("rate_limits")
        .insert({ user_id: userId, month, scan_count: 1, estimated_cost_cents: costCents });
    }
  }
}

// SQL to create the atomic increment function in Supabase:
// CREATE OR REPLACE FUNCTION increment_rate_limit(p_user_id UUID, p_month TEXT, p_cost INT)
// RETURNS VOID AS $$
// BEGIN
//   INSERT INTO rate_limits (user_id, month, scan_count, estimated_cost_cents)
//   VALUES (p_user_id, p_month, 1, p_cost)
//   ON CONFLICT (user_id, month)
//   DO UPDATE SET
//     scan_count = rate_limits.scan_count + 1,
//     estimated_cost_cents = rate_limits.estimated_cost_cents + p_cost;
// END;
// $$ LANGUAGE plpgsql;
