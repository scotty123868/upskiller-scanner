import { google } from "googleapis";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();
export const maxDuration = 120;

const SCOPES_ADMIN = [
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.domain.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
];

const SCOPES_PERSONAL = [
  "https://www.googleapis.com/auth/gmail.readonly",
];

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXTAUTH_URL || "https://upskiller-scanner.vercel.app"}/api/auth/callback`
  );
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "personal";
  const isAdmin = mode === "admin";

  // Check if we have a token (cookie from OAuth callback or auth header)
  const cookieHeader = request.headers.get("cookie") || "";
  const tokenMatch = cookieHeader.match(/scan_token=([^;]+)/);
  const authHeader = request.headers.get("authorization");
  const token = tokenMatch?.[1] || (authHeader ? authHeader.replace("Bearer ", "") : null);

  if (!token) {
    // No token — generate OAuth URL and return 401
    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: isAdmin ? SCOPES_ADMIN : SCOPES_PERSONAL,
      state: mode,
      prompt: "consent",
    });
    return Response.json({ authUrl }, { status: 401 });
  }

  // We have a token — run the scan
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ access_token: token });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const discoveredData: string[] = [];

      try {
        if (isAdmin) {
          await runAdminScan(oauth2Client, send, discoveredData);
        } else {
          await runPersonalScan(oauth2Client, send, discoveredData);
        }

        // Now analyze with Claude
        send({ type: "agent-log", agent: "Ledger", message: "Analyzing all discovered data for waste patterns...", logType: "analysis" });
        send({ type: "progress", records: 100, scanned: 70, message: "Running AI analysis on discovered data..." });

        const allData = discoveredData.join("\n\n");
        await analyzeWithClaude(allData, send, isAdmin);

      } catch (err) {
        console.error("Scan error:", err);
        send({ type: "agent-log", agent: "Dispatch", message: `Scan error: ${err instanceof Error ? err.message : "Unknown error"}`, logType: "progress" });
      }

      send({ type: "progress", records: 100, scanned: 100, message: "Scan complete." });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

async function runAdminScan(
  auth: InstanceType<typeof google.auth.OAuth2>,
  send: (data: unknown) => void,
  discoveredData: string[]
) {
  // 1. List users
  send({ type: "agent-log", agent: "Scout", message: "Connecting to Google Workspace Admin Directory...", logType: "discovery" });
  try {
    const admin = google.admin({ version: "directory_v1", auth });
    const usersRes = await admin.users.list({ customer: "my_customer", maxResults: 200, orderBy: "email" });
    const users = usersRes.data.users || [];
    send({ type: "agent-log", agent: "Scout", message: `Discovered ${users.length} users in the organization`, logType: "discovery" });
    send({ type: "progress", records: 100, scanned: 15, message: `Found ${users.length} users...` });

    const userData = users.map((u) => ({
      email: u.primaryEmail,
      name: u.name?.fullName,
      isAdmin: u.isAdmin,
      suspended: u.suspended,
      lastLogin: u.lastLoginTime,
      creationDate: u.creationTime,
      orgUnit: u.orgUnitPath,
    }));
    discoveredData.push("USERS:\n" + JSON.stringify(userData, null, 2).slice(0, 15000));

    // Check for inactive users
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const inactive = users.filter((u) => u.lastLoginTime && new Date(u.lastLoginTime) < thirtyDaysAgo && !u.suspended);
    if (inactive.length > 0) {
      send({ type: "agent-log", agent: "Scout", message: `${inactive.length} users haven't logged in for 30+ days`, logType: "discovery" });
    }
  } catch (err) {
    send({ type: "agent-log", agent: "Scout", message: `Admin Directory access limited: ${err instanceof Error ? err.message : "permission denied"}`, logType: "progress" });
  }

  // 2. Scan Gmail for invoices/receipts
  send({ type: "agent-log", agent: "Scout", message: "Scanning Gmail for vendor invoices and receipts...", logType: "discovery" });
  await scanGmail(auth, send, discoveredData);
}

async function runPersonalScan(
  auth: InstanceType<typeof google.auth.OAuth2>,
  send: (data: unknown) => void,
  discoveredData: string[]
) {
  send({ type: "agent-log", agent: "Scout", message: "Connecting to Gmail...", logType: "discovery" });
  send({ type: "progress", records: 100, scanned: 10, message: "Connecting to Gmail..." });
  await scanGmail(auth, send, discoveredData);
}

async function scanGmail(
  auth: InstanceType<typeof google.auth.OAuth2>,
  send: (data: unknown) => void,
  discoveredData: string[]
) {
  try {
    const gmail = google.gmail({ version: "v1", auth });

    // Search for invoices, receipts, subscription confirmations
    const queries = [
      "subject:(invoice OR receipt OR payment OR subscription OR renewal OR billing) newer_than:6m",
    ];

    const allEmails: { from: string; subject: string; date: string; snippet: string }[] = [];

    for (const q of queries) {
      const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 100 });
      const messages = res.data.messages || [];
      send({ type: "agent-log", agent: "Scout", message: `Found ${messages.length} financial emails in the last 6 months`, logType: "discovery" });
      send({ type: "progress", records: 100, scanned: 30, message: `Processing ${messages.length} financial emails...` });

      // Read first 50 message headers
      const toRead = messages.slice(0, 50);
      for (let i = 0; i < toRead.length; i++) {
        try {
          const msg = await gmail.users.messages.get({ userId: "me", id: toRead[i].id!, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] });
          const headers = msg.data.payload?.headers || [];
          const from = headers.find((h) => h.name === "From")?.value || "";
          const subject = headers.find((h) => h.name === "Subject")?.value || "";
          const date = headers.find((h) => h.name === "Date")?.value || "";
          allEmails.push({ from, subject, date, snippet: msg.data.snippet || "" });

          if (i % 10 === 0 && i > 0) {
            send({ type: "agent-log", agent: "Scout", message: `Processed ${i}/${toRead.length} emails...`, logType: "progress" });
            send({ type: "progress", records: 100, scanned: 30 + Math.floor((i / toRead.length) * 30), message: `Reading email ${i}/${toRead.length}...` });
          }
        } catch {
          // skip unreadable emails
        }
      }
    }

    // Deduplicate vendors from email senders
    const vendors = new Map<string, number>();
    allEmails.forEach((e) => {
      const domain = e.from.match(/@([^>]+)/)?.[1]?.toLowerCase() || e.from;
      vendors.set(domain, (vendors.get(domain) || 0) + 1);
    });

    send({ type: "agent-log", agent: "Scout", message: `Identified ${vendors.size} unique vendors from email correspondence`, logType: "discovery" });
    send({ type: "progress", records: 100, scanned: 60, message: `Mapped ${vendors.size} vendors from ${allEmails.length} emails` });

    discoveredData.push("FINANCIAL EMAILS (invoices, receipts, billing):\n" + JSON.stringify(allEmails.slice(0, 100), null, 2).slice(0, 20000));
    discoveredData.push("VENDOR FREQUENCY:\n" + JSON.stringify(Object.fromEntries(vendors), null, 2).slice(0, 5000));

  } catch (err) {
    send({ type: "agent-log", agent: "Scout", message: `Gmail scan: ${err instanceof Error ? err.message : "access denied"}`, logType: "progress" });
  }
}

async function analyzeWithClaude(
  data: string,
  send: (data: unknown) => void,
  isAdmin: boolean
) {
  const prompt = isAdmin
    ? `You are an enterprise waste detection AI. Analyze this Google Workspace organization data and find actionable findings.

DATA DISCOVERED:
${data.slice(0, 50000)}

Find 5-10 specific findings. Focus on: unused licenses, inactive users still consuming seats, duplicate tools, vendor consolidation opportunities, subscription waste, compliance gaps. For each finding, estimate annual dollar impact. Reference actual data points.`
    : `You are an enterprise waste detection AI. Analyze this Gmail inbox data to find vendor waste, duplicate subscriptions, and cost savings opportunities.

DATA DISCOVERED:
${data.slice(0, 50000)}

Find 5-8 specific findings. Focus on: duplicate subscriptions, unused services, vendor overcharges, contracts up for renewal, tools that overlap in function. Estimate annual dollar impact where possible. Be specific — reference actual vendor names and email patterns.`;

  const fullPrompt = prompt + `

Respond with a JSON array. Each finding:
- "title": short headline (under 80 chars)
- "description": 1-2 sentences with specific details
- "amount": estimated annual impact like "$340K" or "$12K" (null if not quantifiable)
- "severity": "critical" | "high" | "medium"
- "category": "Licensing" | "Procurement" | "Duplicates" | "Compliance" | "Pricing" | "Operations" | "Risk"

Respond ONLY with the JSON array.`;

  let message;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: fullPrompt }],
      });
      break;
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 529 && attempt < 2) {
        send({ type: "agent-log", agent: "Ledger", message: "High demand — retrying analysis...", logType: "progress" });
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  if (!message) throw new Error("Analysis failed after retries");

  send({ type: "progress", records: 100, scanned: 85, message: "Quantifying findings..." });

  const content = message.content[0];
  if (content.type === "text") {
    let text = content.text.trim();
    if (text.startsWith("```")) text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(text);

    for (let i = 0; i < parsed.length; i++) {
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
      send({ type: "finding", ...parsed[i] });
      send({ type: "progress", records: 100, scanned: 85 + Math.floor((15 * (i + 1)) / parsed.length), message: `Found ${i + 1} of ${parsed.length} findings...` });
    }
  }
}
