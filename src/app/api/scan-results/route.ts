import { supabaseAdmin, isConfigured } from "@/lib/supabase";

export async function GET(request: Request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const userIdMatch = cookieHeader.match(/user_id=([^;]+)/);
  const userId = userIdMatch?.[1];

  // Auth check: require both user_id AND a valid scan_token cookie
  const tokenMatch = cookieHeader.match(/scan_token=([^;]+)/);
  const scanToken = tokenMatch?.[1];

  if (!userId || !isConfigured || !scanToken) {
    return Response.json({ scan: null }, { status: 200 });
  }

  // For read-only results, verify user exists in DB (fast).
  // Token validation happens on write paths (scan, scan-google) to prevent expensive API abuse.
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("id", userId)
    .single();

  if (!user) {
    return Response.json({ scan: null }, { status: 200 });
  }

  // Get latest completed scan with findings (scoped to verified user)
  const { data: scan } = await supabaseAdmin
    .from("scans")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "complete")
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  if (!scan) {
    return Response.json({ scan: null }, { status: 200 });
  }

  // Get findings for this scan
  const { data: findings } = await supabaseAdmin
    .from("findings")
    .select("*")
    .eq("scan_id", scan.id)
    .order("created_at", { ascending: true });

  // Get agent logs
  const { data: agentLogs } = await supabaseAdmin
    .from("agent_logs")
    .select("*")
    .eq("scan_id", scan.id)
    .order("created_at", { ascending: false })
    .limit(30);

  return Response.json({
    scan: {
      ...scan,
      findings: findings || [],
      agentLogs: agentLogs || [],
      workflows: scan.workflows || [],
      org_intelligence: scan.org_intelligence || null,
    },
  });
}
