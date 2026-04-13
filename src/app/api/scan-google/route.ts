import { google } from "googleapis";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();
export const maxDuration = 300; // 5 minutes for deep agentic crawl

// Full agentic crawler scopes — everything we can read
const SCOPES_ADMIN = [
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.domain.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.orgunit.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/admin.reports.usage.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
];

const SCOPES_CRAWL = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
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
  const mode = url.searchParams.get("mode") || "crawl";
  const isAdmin = mode === "admin";

  const cookieHeader = request.headers.get("cookie") || "";
  const tokenMatch = cookieHeader.match(/scan_token=([^;]+)/);
  const authHeader = request.headers.get("authorization");
  const token = tokenMatch?.[1] || (authHeader ? authHeader.replace("Bearer ", "") : null);

  if (!token) {
    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: isAdmin ? SCOPES_ADMIN : SCOPES_CRAWL,
      state: mode,
      prompt: "consent",
    });
    return Response.json({ authUrl }, { status: 401 });
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ access_token: token });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const discoveredData: Record<string, string> = {};
      let totalItems = 0;

      send({ type: "agent-log", agent: "Dispatch", message: "Agentic crawler initialized. Deploying agents across all accessible systems...", logType: "progress" });
      send({ type: "progress", records: 100, scanned: 0, message: "Starting full system crawl..." });

      // ═══════════════════════════════════════════
      // AGENT 1: SCOUT — Discovery & User Mapping
      // ═══════════════════════════════════════════
      if (isAdmin) {
        send({ type: "agent-log", agent: "Scout", message: "Connecting to Google Workspace Admin Directory...", logType: "discovery" });
        try {
          const admin = google.admin({ version: "directory_v1", auth: oauth2Client });

          // Users
          const usersRes = await admin.users.list({ customer: "my_customer", maxResults: 500, orderBy: "email" });
          const users = usersRes.data.users || [];
          send({ type: "agent-log", agent: "Scout", message: `Discovered ${users.length} users across the organization`, logType: "discovery" });
          totalItems += users.length;

          const userData = users.map((u) => ({
            email: u.primaryEmail, name: u.name?.fullName, isAdmin: u.isAdmin,
            suspended: u.suspended, lastLogin: u.lastLoginTime, created: u.creationTime,
            orgUnit: u.orgUnitPath, aliases: u.aliases,
          }));
          discoveredData["USERS"] = JSON.stringify(userData, null, 2).slice(0, 30000);

          // Check for inactive users
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          const inactive = users.filter((u) => u.lastLoginTime && new Date(u.lastLoginTime) < thirtyDaysAgo && !u.suspended);
          const suspended = users.filter((u) => u.suspended);
          send({ type: "agent-log", agent: "Scout", message: `${inactive.length} inactive users (30+ days), ${suspended.length} suspended accounts still provisioned`, logType: "discovery" });

          // Groups
          try {
            const groupsRes = await admin.groups.list({ customer: "my_customer", maxResults: 200 });
            const groups = groupsRes.data.groups || [];
            send({ type: "agent-log", agent: "Scout", message: `Discovered ${groups.length} groups/distribution lists`, logType: "discovery" });
            totalItems += groups.length;
            discoveredData["GROUPS"] = JSON.stringify(groups.map((g) => ({ email: g.email, name: g.name, members: g.directMembersCount })), null, 2).slice(0, 10000);
          } catch { /* groups access may be restricted */ }

          // Org units
          try {
            const orgRes = await admin.orgunits.list({ customerId: "my_customer" });
            const orgs = orgRes.data.organizationUnits || [];
            send({ type: "agent-log", agent: "Scout", message: `Mapped ${orgs.length} organizational units`, logType: "discovery" });
            discoveredData["ORG_UNITS"] = JSON.stringify(orgs.map((o) => ({ name: o.name, path: o.orgUnitPath, parent: o.parentOrgUnitPath })), null, 2);
          } catch { /* org access may be restricted */ }

          // Token/OAuth apps (shadow IT discovery)
          try {
            const reports = google.admin({ version: "reports_v1", auth: oauth2Client });
            const tokenRes = await reports.activities.list({
              userKey: "all", applicationName: "token",
              maxResults: 500, eventName: "authorize",
            });
            const tokenEvents = tokenRes.data.items || [];
            const appNames = new Map<string, number>();
            tokenEvents.forEach((e) => {
              const appName = e.events?.[0]?.parameters?.find((p) => p.name === "app_name")?.value;
              if (appName) appNames.set(appName, (appNames.get(appName) || 0) + 1);
            });
            send({ type: "agent-log", agent: "Scout", message: `Discovered ${appNames.size} third-party apps connected via OAuth (shadow IT scan)`, logType: "discovery" });
            totalItems += appNames.size;
            discoveredData["OAUTH_APPS"] = JSON.stringify(Object.fromEntries(appNames), null, 2).slice(0, 15000);
          } catch {
            send({ type: "agent-log", agent: "Scout", message: "OAuth app audit requires Reports API access — skipping shadow IT scan", logType: "progress" });
          }

        } catch (err) {
          send({ type: "agent-log", agent: "Scout", message: `Admin access limited: ${err instanceof Error ? err.message.slice(0, 80) : "permission denied"}`, logType: "progress" });
        }
      }

      send({ type: "progress", records: 100, scanned: 15, message: `Discovered ${totalItems} items so far...` });

      // ═══════════════════════════════════════════
      // AGENT 2: LEDGER — Gmail Financial Crawl
      // ═══════════════════════════════════════════
      send({ type: "agent-log", agent: "Ledger", message: "Scanning Gmail for financial signals — invoices, receipts, renewals, subscriptions...", logType: "analysis" });
      try {
        const gmail = google.gmail({ version: "v1", auth: oauth2Client });

        const searches = [
          { q: "subject:(invoice OR factura OR rechnung) newer_than:6m", label: "invoices" },
          { q: "subject:(receipt OR payment confirmation OR payment received) newer_than:6m", label: "receipts" },
          { q: "subject:(subscription OR renewal OR renewing OR auto-renew) newer_than:6m", label: "subscriptions" },
          { q: "subject:(license OR licence OR seat OR upgrade OR downgrade) newer_than:6m", label: "licenses" },
          { q: "subject:(contract OR agreement OR SOW OR proposal OR quote) newer_than:6m", label: "contracts" },
          { q: "subject:(expense OR reimbursement OR per diem) newer_than:6m", label: "expenses" },
        ];

        const allEmails: { from: string; subject: string; date: string; snippet: string; category: string }[] = [];
        const vendorMap = new Map<string, { count: number; categories: Set<string> }>();

        for (const search of searches) {
          try {
            const res = await gmail.users.messages.list({ userId: "me", q: search.q, maxResults: 200 });
            const messages = res.data.messages || [];
            send({ type: "agent-log", agent: "Ledger", message: `Found ${messages.length} ${search.label} emails`, logType: "discovery" });
            totalItems += messages.length;

            const batch = messages.slice(0, 80);
            for (let i = 0; i < batch.length; i++) {
              try {
                const msg = await gmail.users.messages.get({ userId: "me", id: batch[i].id!, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] });
                const headers = msg.data.payload?.headers || [];
                const from = headers.find((h) => h.name === "From")?.value || "";
                const subject = headers.find((h) => h.name === "Subject")?.value || "";
                const date = headers.find((h) => h.name === "Date")?.value || "";
                allEmails.push({ from, subject, date, snippet: msg.data.snippet || "", category: search.label });

                const domain = from.match(/@([^>]+)/)?.[1]?.toLowerCase() || from;
                if (!vendorMap.has(domain)) vendorMap.set(domain, { count: 0, categories: new Set() });
                const v = vendorMap.get(domain)!;
                v.count++;
                v.categories.add(search.label);
              } catch { /* skip unreadable */ }
            }
          } catch { /* search may fail */ }
        }

        send({ type: "agent-log", agent: "Ledger", message: `Processed ${allEmails.length} financial emails from ${vendorMap.size} unique vendors`, logType: "discovery" });
        send({ type: "progress", records: 100, scanned: 40, message: `Crawled ${allEmails.length} emails, ${vendorMap.size} vendors...` });

        discoveredData["FINANCIAL_EMAILS"] = JSON.stringify(allEmails.slice(0, 500), null, 2).slice(0, 80000);
        discoveredData["VENDOR_MAP"] = JSON.stringify(
          [...vendorMap.entries()].map(([domain, v]) => ({
            domain, emailCount: v.count, categories: [...v.categories],
          })).sort((a, b) => b.emailCount - a.emailCount),
          null, 2
        ).slice(0, 20000);

      } catch (err) {
        send({ type: "agent-log", agent: "Ledger", message: `Gmail access: ${err instanceof Error ? err.message.slice(0, 60) : "denied"}`, logType: "progress" });
      }

      // ═══════════════════════════════════════════
      // AGENT 3: QUARTERMASTER — Drive Document Scan
      // ═══════════════════════════════════════════
      send({ type: "agent-log", agent: "Quartermaster", message: "Scanning Google Drive for contracts, SOWs, and procurement documents...", logType: "analysis" });
      try {
        const drive = google.drive({ version: "v3", auth: oauth2Client });

        const driveSearches = [
          { q: "name contains 'contract' or name contains 'agreement' or name contains 'SOW'", label: "contracts" },
          { q: "name contains 'invoice' or name contains 'PO' or name contains 'purchase order'", label: "procurement" },
          { q: "name contains 'budget' or name contains 'forecast' or name contains 'spend'", label: "budgets" },
          { q: "name contains 'vendor' or name contains 'supplier' or name contains 'RFP'", label: "vendor docs" },
        ];

        const allDocs: { name: string; mimeType: string; modified: string; owner: string; shared: boolean; category: string }[] = [];

        for (const search of driveSearches) {
          try {
            const res = await drive.files.list({
              q: search.q, pageSize: 100,
              fields: "files(name,mimeType,modifiedTime,owners,shared,sharingUser)",
            });
            const files = res.data.files || [];
            send({ type: "agent-log", agent: "Quartermaster", message: `Found ${files.length} ${search.label} documents in Drive`, logType: "discovery" });
            totalItems += files.length;

            files.forEach((f) => {
              allDocs.push({
                name: f.name || "", mimeType: f.mimeType || "",
                modified: f.modifiedTime || "", owner: f.owners?.[0]?.emailAddress || "",
                shared: f.shared || false, category: search.label,
              });
            });
          } catch { /* search may fail */ }
        }

        send({ type: "agent-log", agent: "Quartermaster", message: `Indexed ${allDocs.length} procurement-related documents`, logType: "discovery" });
        discoveredData["DRIVE_DOCUMENTS"] = JSON.stringify(allDocs.slice(0, 200), null, 2).slice(0, 30000);

      } catch (err) {
        send({ type: "agent-log", agent: "Quartermaster", message: `Drive access: ${err instanceof Error ? err.message.slice(0, 60) : "denied"}`, logType: "progress" });
      }

      send({ type: "progress", records: 100, scanned: 55, message: `${totalItems} items discovered across all systems...` });

      // ═══════════════════════════════════════════
      // AGENT 4: SIGNAL — Calendar & Meeting Analysis
      // ═══════════════════════════════════════════
      send({ type: "agent-log", agent: "Signal", message: "Analyzing calendar for vendor meetings, review cadences, and operational patterns...", logType: "analysis" });
      try {
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        const now = new Date();
        const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

        const calRes = await calendar.events.list({
          calendarId: "primary",
          timeMin: sixMonthsAgo.toISOString(),
          timeMax: now.toISOString(),
          maxResults: 500,
          singleEvents: true,
          orderBy: "startTime",
        });
        const events = calRes.data.items || [];
        send({ type: "agent-log", agent: "Signal", message: `Analyzed ${events.length} calendar events from last 6 months`, logType: "discovery" });
        totalItems += events.length;

        // Extract meeting patterns
        const meetingTypes = new Map<string, number>();
        const vendorMeetings: { summary: string; date: string; attendees: number; organizer: string }[] = [];

        events.forEach((e) => {
          const summary = (e.summary || "").toLowerCase();
          if (summary.includes("vendor") || summary.includes("review") || summary.includes("renewal") || summary.includes("contract") || summary.includes("demo") || summary.includes("onboarding")) {
            vendorMeetings.push({
              summary: e.summary || "",
              date: e.start?.dateTime || e.start?.date || "",
              attendees: e.attendees?.length || 0,
              organizer: e.organizer?.email || "",
            });
          }
          // Categorize meeting types
          const type = summary.includes("standup") || summary.includes("sync") ? "recurring-sync" :
            summary.includes("review") ? "review" :
            summary.includes("1:1") || summary.includes("one on one") ? "1:1" :
            summary.includes("demo") ? "demo" : "other";
          meetingTypes.set(type, (meetingTypes.get(type) || 0) + 1);
        });

        send({ type: "agent-log", agent: "Signal", message: `${vendorMeetings.length} vendor-related meetings, ${meetingTypes.get("recurring-sync") || 0} recurring syncs`, logType: "discovery" });
        discoveredData["CALENDAR_EVENTS"] = JSON.stringify({ vendorMeetings: vendorMeetings.slice(0, 50), meetingTypes: Object.fromEntries(meetingTypes), totalEvents: events.length }, null, 2).slice(0, 15000);

      } catch (err) {
        send({ type: "agent-log", agent: "Signal", message: `Calendar access: ${err instanceof Error ? err.message.slice(0, 60) : "denied"}`, logType: "progress" });
      }

      send({ type: "progress", records: 100, scanned: 65, message: `Full crawl complete. ${totalItems} items discovered. Running Opus analysis...` });

      // ═══════════════════════════════════════════
      // AGENT 5: ATLAS — Opus 4.6 Deep Analysis
      // ═══════════════════════════════════════════
      send({ type: "agent-log", agent: "Atlas", message: "All agents reported. Running Opus 4.6 deep analysis across all discovered data...", logType: "analysis" });

      const allData = Object.entries(discoveredData)
        .map(([key, value]) => `=== ${key} ===\n${value}`)
        .join("\n\n");

      try {
        await analyzeWithOpus(allData, send, isAdmin, totalItems);
      } catch (err) {
        send({ type: "agent-log", agent: "Atlas", message: `Analysis error: ${err instanceof Error ? err.message : "unknown"}`, logType: "progress" });
      }

      send({ type: "progress", records: 100, scanned: 100, message: "Scan complete." });
      send({ type: "agent-log", agent: "Dispatch", message: `Agentic crawl complete. ${totalItems} items analyzed across all accessible systems.`, logType: "progress" });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

async function analyzeWithOpus(
  data: string,
  send: (data: unknown) => void,
  isAdmin: boolean,
  totalItems: number
) {
  const prompt = `You are UpSkiller AI's Atlas agent, the most thorough enterprise waste detection system in existence. You have just received the complete output of an agentic crawl across a ${isAdmin ? "Google Workspace organization" : "user's Google account"}.

## DISCOVERED DATA (${totalItems} items crawled)

${data.slice(0, 500000)}

## YOUR MISSION

Analyze ALL of this data to produce a complete operational assessment. This will populate an executive Command Center dashboard.

Run these analysis passes:

### 1. USER & LICENSE WASTE (from Users data)
- Inactive accounts still consuming licenses
- Suspended users with active integrations
- Over-provisioned admin access
- License cost estimation (Google Workspace Business: ~$14/user/month)

### 2. SHADOW IT & APP SPRAWL (from OAuth Apps data)
- Unauthorized third-party apps with org data access
- Redundant tools (multiple apps serving same function)
- Security risks (apps with broad permissions)
- Apps no longer actively used

### 3. VENDOR INTELLIGENCE (from Email + Drive data)
- Vendor concentration risks
- Contract renewal opportunities visible in email patterns
- Duplicate vendor relationships for same service category
- Price negotiation leverage from email volume patterns

### 4. PROCUREMENT WASTE (from Drive documents + Emails)
- Contracts approaching renewal without review
- SOWs and agreements that may be stale
- Budget documents suggesting inefficiencies
- Procurement process gaps

### 5. OPERATIONAL PATTERNS (from Calendar + Email)
- Meeting overhead (excessive vendor meetings, recurring syncs)
- Process bottlenecks visible in email cadence
- Key person dependencies (who has all vendor relationships?)
- Communication patterns suggesting inefficiency

### 6. COMPLIANCE & RISK
- Data sharing risks (widely shared sensitive documents)
- Audit trail gaps
- Access control issues
- Regulatory exposure signals

### 7. KNOWLEDGE & INSTITUTIONAL RISK
- Single points of failure in vendor relationships
- Tribal knowledge concentrated in specific users
- Documentation gaps
- Succession planning risks

## OUTPUT FORMAT

{
  "summary": {
    "totalAnnualWaste": "$X.XM",
    "findingsCount": N,
    "criticalCount": N,
    "departments": ["list of departments/teams identified"],
    "vendors": N,
    "topRiskArea": "one sentence on biggest risk",
    "itemsCrawled": ${totalItems},
    "systemsAccessed": ["Gmail", "Drive", "Calendar", "Admin Directory", etc.]
  },
  "findings": [
    {
      "title": "Short headline under 80 chars",
      "description": "2-3 sentences with SPECIFIC data. Reference actual vendor domains, user emails, document names, dates.",
      "amount": "$XXK or null",
      "severity": "critical | high | medium",
      "category": "Duplicates | Procurement | Licensing | Compliance | Operations | Risk | Knowledge | Pricing",
      "department": "inferred department or team",
      "agent": "Ledger | Quartermaster | Chief | Scout | Signal | Atlas",
      "recommendation": "SPECIFIC action. Not 'review this' but 'revoke OAuth access for app X, contact vendor Y before renewal on date Z'",
      "evidence": "specific data points from the crawl",
      "timeToValue": "immediate | 30 days | 90 days | 6 months"
    }
  ]
}

RULES:
- Find 15-25 findings. Be exhaustive.
- Every finding references SPECIFIC data from the crawl (actual vendor domains, user emails, document names)
- Estimate dollar amounts wherever possible (use industry benchmarks: Google Workspace ~$14/user/mo, typical SaaS ~$50-200/user/mo)
- Prioritize by annual impact
- For each finding, recommend a SPECIFIC action

Respond ONLY with the JSON object.`;

  let message;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      message = await anthropic.messages.create({
        model: "claude-opus-4-20250514",
        max_tokens: 16384,
        messages: [{ role: "user", content: prompt }],
      });
      break;
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 529 && attempt < 2) {
        send({ type: "agent-log", agent: "Atlas", message: "High demand — retrying deep analysis...", logType: "progress" });
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  if (!message) throw new Error("Analysis failed after retries");

  send({ type: "progress", records: 100, scanned: 80, message: "Opus analysis complete. Streaming findings..." });
  send({ type: "agent-log", agent: "Atlas", message: "Deep analysis complete. Delivering findings...", logType: "analysis" });

  const content = message.content[0];
  if (content.type === "text") {
    let text = content.text.trim();
    if (text.startsWith("```")) text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

    const parsed = JSON.parse(text);
    const findings = parsed.findings || parsed;
    const summary = parsed.summary;

    if (summary) {
      send({ type: "summary", ...summary });
      send({ type: "agent-log", agent: "Dispatch", message: `Total waste identified: ${summary.totalAnnualWaste} across ${summary.findingsCount} findings from ${summary.systemsAccessed?.length || 0} systems`, logType: "finding" });
    }

    for (let i = 0; i < findings.length; i++) {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 200));
      const f = findings[i];
      send({ type: "agent-log", agent: f.agent || "Atlas", message: `${f.title}${f.amount ? " — " + f.amount : ""}`, logType: "finding" });
      send({ type: "finding", ...f });
      send({ type: "progress", records: 100, scanned: 80 + Math.floor((20 * (i + 1)) / findings.length), message: `Delivered ${i + 1} of ${findings.length} findings...` });
    }
  }
}
