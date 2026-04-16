import { google } from "googleapis";
import Anthropic from "@anthropic-ai/sdk";
import { SAAS_DATABASE, lookupDomain, estimateAnnualCost, formatCost, TOTAL_APPS } from "@/data/saas-pricing";
import { checkRateLimit, recordScanCost, createScan, saveFinding, completeScan } from "@/lib/supabase";

const anthropic = new Anthropic();
export const maxDuration = 300;

const SCOPES_ADMIN = [
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.domain.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const SCOPES_CRAWL = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXTAUTH_URL || "https://upskiller-scanner.vercel.app"}/api/auth/callback`
  );
}

// ─── Types for pre-processed intelligence ───

type EmailMeta = {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: string;
  threadId: string;
  hasAttachment: boolean;
  isForward: boolean;
  isReply: boolean;
  domain: string;
};

type FinancialEmail = {
  from: string;
  subject: string;
  date: string;
  body: string;
  category: string;
  amounts: string[];
  domain: string;
};

type CalendarEvent = {
  summary: string;
  date: string;
  duration: number; // minutes
  attendeeCount: number;
  externalDomains: string[];
  isRecurring: boolean;
  conferenceType: string | null;
  organizer: string;
  myResponseStatus: "accepted" | "declined" | "tentative" | "needsAction" | "unknown";
  recurringEventId: string | null;
};

type DriveFile = {
  name: string;
  mimeType: string;
  modified: string;
  owner: string;
  shared: boolean;
  sharedWith: number;
  category: string;
};

type CommGraphNode = {
  email: string;
  domain: string;
  sent: number;
  received: number;
  isInternal: boolean;
};

type CadencePattern = {
  sender: string;
  subjectPattern: string;
  frequency: string;
  dayOfWeek: string;
  recipientCount: number;
  exampleSubjects: string[];
  count: number;
};

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
    const csrfToken = crypto.randomUUID().slice(0, 16);
    const stateParam = `${csrfToken}:${mode}`;
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: isAdmin ? SCOPES_ADMIN : SCOPES_CRAWL,
      state: stateParam,
      prompt: "consent",
    });
    return new Response(JSON.stringify({ authUrl, csrfToken, csrfState: stateParam }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `oauth_state=${stateParam}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`,
      },
    });
  }

  // Rate limit check
  const userIdMatch = cookieHeader.match(/user_id=([^;]+)/);
  const userId = userIdMatch?.[1] || "";

  if (userId) {
    const rateLimit = await checkRateLimit(userId);
    if (!rateLimit.allowed) {
      return Response.json(
        { error: "Rate limit exceeded. You have reached the maximum number of scans for this month.", scansUsed: rateLimit.scansUsed },
        { status: 429 }
      );
    }
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ access_token: token });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* controller already closed */ }
      };

      try {
      // Create scan record
      let scanId = "";
      if (userId) {
        try {
          const scan = await createScan(userId, "google");
          scanId = scan.id;
        } catch { /* Supabase may not be configured */ }
      }

      // ═══════════════════════════════════════
      // Collected data across all agents
      // ═══════════════════════════════════════
      const discoveredApps = new Map<string, { app: typeof SAAS_DATABASE[0]; emailCount: number; categories: Set<string>; amounts: number[] }>();
      const allEmailMeta: EmailMeta[] = [];
      const allFinancialEmails: FinancialEmail[] = [];
      const allCalendarEvents: CalendarEvent[] = [];
      const allDriveFiles: DriveFile[] = [];
      let orgUserCount = 0;
      let totalItems = 0;
      let userDomain = ""; // The org's email domain
      let calMeetingTypes: Record<string, number> = {};
      let calBackToBack = 0;
      let calDeclined = 0;
      let calAccepted = 0;
      let calTentative = 0;
      let calTopRecurring: { title: string; occurrences: number; totalMinutes: number; attendeeAvg: number }[] = [];
      let calFocusTimeHours = 0;
      let calMeetingHoursPerWeek = 0;
      let calHeaviestMeetingDay: { day: string; hours: number } = { day: "", hours: 0 };

      // Detect the user's org domain from their email
      try {
        const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const email = userInfo.data.email || "";
        const rawDomain = email.split("@")[1] || "";
        // Don't treat freemail domains as org domains
        const FREEMAIL_DOMAINS = ["gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "live.com", "msn.com"];
        if (!FREEMAIL_DOMAINS.includes(rawDomain)) {
          userDomain = rawDomain;
        }
      } catch { /* fall back to detecting from email patterns */ }

      send({ type: "agent-log", agent: "Dispatch", message: `Agentic crawler initialized. ${TOTAL_APPS} apps in pricing database. Deploying agents...`, logType: "progress" });
      send({ type: "progress", records: 100, scanned: 1, message: "Connecting to Gmail..." });
      send({ type: "agent-log", agent: "Scout", message: "Connecting to Google Workspace APIs...", logType: "progress" });

      // ═══════════════════════════════════════
      // AGENT 1: SCOUT — Full Email Metadata Extraction
      // Now fetches To/CC/BCC/threadId on ALL recent emails
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Scout", message: "Scanning Gmail metadata: senders, recipients, threads, attachments...", logType: "discovery" });

      try {
        const gmail = google.gmail({ version: "v1", auth: oauth2Client });

        // Paginate Gmail list API to get up to ~5000 emails. Batched parallel reads
        // mean this completes in ~25-30 seconds even at the upper end.
        const messageIds: { id?: string | null }[] = [];
        let pageToken: string | undefined = undefined;
        const MAX_EMAILS = 5000;
        while (messageIds.length < MAX_EMAILS) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const listRes: any = await gmail.users.messages.list({
            userId: "me", maxResults: 500, q: "newer_than:6m", pageToken,
          });
          const pageMessages = listRes.data.messages || [];
          if (pageMessages.length === 0) break;
          messageIds.push(...pageMessages);
          pageToken = listRes.data.nextPageToken || undefined;
          if (!pageToken) break;
          send({ type: "progress", records: 100, scanned: 2, message: `Found ${messageIds.length} emails so far...` });
        }
        send({ type: "agent-log", agent: "Scout", message: `Found ${messageIds.length} emails in last 6 months. Extracting metadata in parallel...`, logType: "discovery" });

        const senderDomains = new Map<string, number>();
        // Process up to 3000 for metadata (parallel batches are fast)
        const batch = messageIds.slice(0, 3000);

        // Parse email addresses from header
        const extractEmails = (header: string): string[] => {
          const matches = header.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
          return [...new Set(matches.map((e) => e.toLowerCase()))];
        };

        // Process a single message metadata
        const processMessage = async (msgId: string) => {
          try {
            const msg = await gmail.users.messages.get({
              userId: "me", id: msgId, format: "metadata",
              metadataHeaders: ["From", "To", "Cc", "Subject", "Date", "Content-Type", "List-Unsubscribe", "Reply-To"],
            });
            const headers = msg.data.payload?.headers || [];
            const getHeader = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
            const from = getHeader("From");
            const subject = getHeader("Subject");
            const contentType = getHeader("Content-Type");
            const fromEmail = extractEmails(from)[0] || "";
            const domain = fromEmail.split("@")[1]?.replace(/^(noreply\.|no-reply\.|notifications\.|info\.|support\.|billing\.|team\.|hello\.)/, "").replace(/^www\./, "") || "";

            return {
              from: fromEmail,
              to: extractEmails(getHeader("To")),
              cc: extractEmails(getHeader("Cc")),
              subject,
              date: getHeader("Date"),
              threadId: msg.data.threadId || "",
              hasAttachment: contentType.includes("mixed") || contentType.includes("attachment"),
              isForward: subject.toLowerCase().startsWith("fwd:") || subject.toLowerCase().startsWith("fw:"),
              isReply: subject.toLowerCase().startsWith("re:"),
              domain,
            } as EmailMeta;
          } catch { return null; }
        };

        // Parallel batches of 20 (10-20x faster than sequential)
        const BATCH_SIZE = 20;
        for (let i = 0; i < batch.length; i += BATCH_SIZE) {
          const chunk = batch.slice(i, i + BATCH_SIZE);
          const results = await Promise.all(chunk.map((m) => processMessage(m.id!)));
          for (const meta of results) {
            if (!meta) continue;
            allEmailMeta.push(meta);
            if (meta.domain) {
              senderDomains.set(meta.domain, (senderDomains.get(meta.domain) || 0) + 1);
            }
          }
          // Update progress every batch (user sees movement immediately)
          const processed = Math.min(i + BATCH_SIZE, batch.length);
          const pct = Math.floor((processed / batch.length) * 15);
          const domainsFound = senderDomains.size;
          send({ type: "progress", records: 100, scanned: Math.max(2, pct), message: `Reading ${processed}/${batch.length} emails... ${domainsFound} domains found` });
        }

        // Match sender domains against SaaS database
        for (const [domain, count] of senderDomains) {
          const app = lookupDomain(domain);
          if (app) {
            if (!discoveredApps.has(app.name)) {
              discoveredApps.set(app.name, { app, emailCount: 0, categories: new Set(), amounts: [] });
            }
            const entry = discoveredApps.get(app.name)!;
            entry.emailCount += count;
            entry.categories.add(app.category);
          }
        }

        // Auto-detect org domain from most common internal domain if not from userinfo
        if (!userDomain) {
          const domainCounts = new Map<string, number>();
          for (const email of allEmailMeta) {
            for (const addr of [email.from, ...email.to]) {
              const d = addr.split("@")[1];
              if (d && !d.includes("gmail.com") && !d.includes("yahoo.") && !d.includes("hotmail.") && !d.includes("outlook.")) {
                domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
              }
            }
          }
          const sorted = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);
          if (sorted.length > 0) userDomain = sorted[0][0];
        }

        totalItems += allEmailMeta.length;
        send({ type: "agent-log", agent: "Scout", message: `${allEmailMeta.length} emails analyzed. ${discoveredApps.size} SaaS tools from ${senderDomains.size} domains. Org domain: ${userDomain || "unknown"}`, logType: "discovery" });

        const appList = [...discoveredApps.entries()].sort((a, b) => b[1].emailCount - a[1].emailCount);
        const topApps = appList.slice(0, 10).map(([name, d]) => `${name}(${d.emailCount})`).join(", ");
        send({ type: "agent-log", agent: "Scout", message: `Top apps: ${topApps}`, logType: "discovery" });

      } catch (err) {
        send({ type: "agent-log", agent: "Scout", message: `Gmail metadata: ${err instanceof Error ? err.message.slice(0, 60) : "access denied"}`, logType: "progress" });
      }

      // Fetch Gmail labels for workflow/department signals
      const gmailLabels: string[] = [];
      try {
        const gmail = google.gmail({ version: "v1", auth: oauth2Client });
        const labelsRes = await gmail.users.labels.list({ userId: "me" });
        const labels = labelsRes.data.labels || [];
        for (const l of labels) {
          if (l.type === "user" && l.name) gmailLabels.push(l.name);
        }
        if (gmailLabels.length > 0) {
          send({ type: "agent-log", agent: "Scout", message: `Found ${gmailLabels.length} custom labels: ${gmailLabels.slice(0, 10).join(", ")}${gmailLabels.length > 10 ? "..." : ""}`, logType: "discovery" });
        }
      } catch { /* labels not accessible */ }

      // Detect role inboxes from email addresses
      const roleInboxes = new Set<string>();
      const rolePatterns = /^(ops|billing|support|sales|hr|finance|admin|info|team|help|ap|ar|accounting|payroll|recruiting|it|security)@/i;
      for (const email of allEmailMeta) {
        for (const addr of [email.from, ...email.to, ...email.cc]) {
          if (rolePatterns.test(addr)) roleInboxes.add(addr);
        }
      }
      if (roleInboxes.size > 0) {
        send({ type: "agent-log", agent: "Scout", message: `Detected ${roleInboxes.size} role inboxes: ${[...roleInboxes].slice(0, 5).join(", ")}`, logType: "discovery" });
      }

      send({ type: "progress", records: 100, scanned: 15, message: `${discoveredApps.size} SaaS tools found. Deep scanning financial emails...` });

      // ═══════════════════════════════════════
      // AGENT 2: LEDGER — Financial Email Deep Scan
      // Same approach, better amount context extraction
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Ledger", message: "Deep scanning financial emails for invoices, amounts, contracts...", logType: "analysis" });

      try {
        const gmail = google.gmail({ version: "v1", auth: oauth2Client });

        const searches = [
          { q: "subject:(invoice OR factura) newer_than:6m", label: "invoices" },
          { q: "subject:(receipt OR payment confirmation) newer_than:6m", label: "receipts" },
          { q: "subject:(subscription OR renewal OR auto-renew) newer_than:6m", label: "subscriptions" },
          { q: "subject:(license OR licence OR seat) newer_than:6m", label: "licenses" },
          { q: "subject:(contract OR agreement OR SOW) newer_than:6m", label: "contracts" },
          { q: "subject:(expense OR reimbursement) newer_than:6m", label: "expenses" },
          { q: "subject:(upgrade OR downgrade OR plan change) newer_than:6m", label: "plan changes" },
          { q: "subject:(billing OR charge OR payment due) newer_than:6m", label: "billing" },
        ];

        const seenMessageIds = new Set<string>(); // Dedupe across searches

        for (const search of searches) {
          try {
            const res = await gmail.users.messages.list({ userId: "me", q: search.q, maxResults: 100 });
            const messages = (res.data.messages || []).filter((m) => !seenMessageIds.has(m.id!));
            if (messages.length === 0) continue;
            messages.forEach((m) => seenMessageIds.add(m.id!));

            send({ type: "agent-log", agent: "Ledger", message: `Found ${messages.length} ${search.label} emails`, logType: "discovery" });
            totalItems += messages.length;

            // Parallel batch reads for financial emails (10x faster)
            const toRead = messages.slice(0, 40);
            for (let bi = 0; bi < toRead.length; bi += 10) {
              const chunk = toRead.slice(bi, bi + 10);
              const results = await Promise.all(chunk.map(async (m) => {
                try {
                  const msg = await gmail.users.messages.get({ userId: "me", id: m.id!, format: "full" });
                  const headers = msg.data.payload?.headers || [];
                  const from = headers.find((h) => h.name === "From")?.value || "";
                  const subject = headers.find((h) => h.name === "Subject")?.value || "";
                  const date = headers.find((h) => h.name === "Date")?.value || "";
                  let body = "";
                  const payload = msg.data.payload;
                  if (payload?.body?.data) {
                    body = Buffer.from(payload.body.data, "base64").toString("utf-8");
                  } else if (payload?.parts) {
                    for (const part of payload.parts) {
                      if (part.mimeType === "text/plain" && part.body?.data) {
                        body = Buffer.from(part.body.data, "base64").toString("utf-8");
                        break;
                      }
                    }
                  }
                  if (!body) body = msg.data.snippet || "";
                  const amounts = [...new Set(body.match(/\$[\d,]+(?:\.\d{2})?/g) || [])];
                  const domain = from.match(/@([^>]+)/)?.[1]?.toLowerCase().replace(/^www\./, "") || "";
                  return { from, subject, date, body: body.slice(0, 2000), category: search.label, amounts, domain };
                } catch { return null; }
              }));
              for (const r of results) {
                if (!r) continue;
                if (r.domain) {
                  const app = lookupDomain(r.domain);
                  if (app && discoveredApps.has(app.name)) {
                    const entry = discoveredApps.get(app.name)!;
                    r.amounts.forEach((a) => {
                      const num = parseFloat(a.replace(/[$,]/g, ""));
                      if (!isNaN(num) && num > 0 && num < 1000000) entry.amounts.push(num);
                    });
                  }
                }
                allFinancialEmails.push(r);
              }
            }
          } catch { /* search may fail */ }
        }

        send({ type: "agent-log", agent: "Ledger", message: `Processed ${allFinancialEmails.length} financial emails. ${allFinancialEmails.reduce((s, e) => s + e.amounts.length, 0)} dollar amounts extracted.`, logType: "discovery" });

      } catch (err) {
        send({ type: "agent-log", agent: "Ledger", message: `Gmail financial scan: ${err instanceof Error ? err.message.slice(0, 60) : "denied"}`, logType: "progress" });
      }

      send({ type: "progress", records: 100, scanned: 35, message: `${totalItems} items scanned. Scanning Drive and Calendar...` });

      // ═══════════════════════════════════════
      // AGENT 3: QUARTERMASTER — Expanded Drive Scan
      // Now fetches mimeType, sharing, permissions
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Quartermaster", message: "Scanning Drive: contracts, shared files, collaboration patterns...", logType: "analysis" });

      try {
        const drive = google.drive({ version: "v3", auth: oauth2Client });
        const driveSearches = [
          { q: "trashed=false and (name contains 'contract' or name contains 'agreement' or name contains 'SOW' or name contains 'MSA' or name contains 'NDA')", cat: "contracts" },
          { q: "trashed=false and (name contains 'invoice' or name contains 'PO' or name contains 'purchase' or name contains 'receipt')", cat: "procurement" },
          { q: "trashed=false and (name contains 'budget' or name contains 'vendor' or name contains 'renewal' or name contains 'forecast')", cat: "finance" },
          { q: "trashed=false and (name contains 'report' or name contains 'dashboard' or name contains 'kpi' or name contains 'metrics')", cat: "reports" },
          { q: "trashed=false and (name contains 'roadmap' or name contains 'plan' or name contains 'okrs' or name contains 'strategy')", cat: "planning" },
          { q: "trashed=false and mimeType='application/vnd.google-apps.spreadsheet'", cat: "spreadsheet" },
          { q: "trashed=false and mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'", cat: "spreadsheet" },
          { q: "trashed=false and mimeType='application/vnd.google-apps.document' and modifiedTime > '" + new Date(Date.now() - 30*24*60*60*1000).toISOString() + "'", cat: "recent_docs" },
        ];

        const seenFileIds = new Set<string>();
        for (const search of driveSearches) {
          try {
            const res = await drive.files.list({
              q: search.q,
              pageSize: 50,
              fields: "files(id,name,mimeType,modifiedTime,owners,shared,permissions)",
              corpora: "allDrives",
              includeItemsFromAllDrives: true,
              supportsAllDrives: true,
            });
            const files = res.data.files || [];
            totalItems += files.length;
            for (const f of files) {
              const fileId = f.id || f.name || "";
              if (seenFileIds.has(fileId)) continue;
              seenFileIds.add(fileId);
              allDriveFiles.push({
                name: f.name || "",
                mimeType: f.mimeType || "",
                modified: f.modifiedTime || "",
                owner: f.owners?.[0]?.emailAddress || "",
                shared: !!f.shared,
                sharedWith: f.permissions?.length || 0,
                category: search.cat,
              });
            }
          } catch { /* skip */ }
        }

        const sharedSpreadsheets = allDriveFiles.filter((f) => f.category === "spreadsheet" && f.shared);
        send({ type: "agent-log", agent: "Quartermaster", message: `${allDriveFiles.length} documents found. ${sharedSpreadsheets.length} shared spreadsheets (potential manual data processes).`, logType: "discovery" });

      } catch (err) {
        send({ type: "agent-log", agent: "Quartermaster", message: `Drive scan: ${err instanceof Error ? err.message.slice(0, 60) : "denied"}`, logType: "progress" });
      }

      // ═══════════════════════════════════════
      // AGENT 4: SIGNAL — Full Calendar Analysis
      // Now extracts ALL events, attendee domains, recurring, conference
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Signal", message: "Full calendar analysis: meetings, attendees, recurring patterns, tools...", logType: "analysis" });

      try {
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

        // Scan all accessible calendars, not just primary
        const calendarIds: string[] = ["primary"];
        try {
          const calListRes = await calendar.calendarList.list({ maxResults: 50 });
          const cals = calListRes.data.items || [];
          for (const c of cals) {
            if (c.id && c.id !== "primary" && c.accessRole !== "freeBusyReader") {
              calendarIds.push(c.id);
            }
          }
          if (calendarIds.length > 1) {
            send({ type: "agent-log", agent: "Signal", message: `Found ${calendarIds.length} calendars to scan`, logType: "discovery" });
          }
        } catch { /* fall back to primary only */ }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allEvents: any[] = [];
        for (const calId of calendarIds.slice(0, 10)) { // Cap at 10 calendars
          try {
            // Paginate up to 1000 events per calendar
            let pageToken: string | undefined = undefined;
            let fetched = 0;
            while (fetched < 1000) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const calRes: any = await calendar.events.list({
                calendarId: calId,
                timeMin: sixMonthsAgo.toISOString(),
                timeMax: new Date().toISOString(),
                maxResults: 500, singleEvents: true, orderBy: "startTime",
                pageToken,
              });
              const items = calRes.data.items || [];
              if (items.length === 0) break;
              allEvents.push(...items);
              fetched += items.length;
              pageToken = calRes.data.nextPageToken || undefined;
              if (!pageToken) break;
            }
          } catch { /* skip inaccessible calendars */ }
        }

        // Deduplicate events across calendars by iCalUID + start time
        const seenEventKeys = new Set<string>();
        const events = allEvents.filter((e) => {
          const key = `${e.iCalUID || e.id}::${e.start?.dateTime || e.start?.date || ""}`;
          if (seenEventKeys.has(key)) return false;
          seenEventKeys.add(key);
          return true;
        });
        totalItems += events.length;

        for (const e of events) {
          // Handle both timed events and all-day events
          let duration = 0;
          if (e.start?.dateTime && e.end?.dateTime) {
            const start = new Date(e.start.dateTime);
            const end = new Date(e.end.dateTime);
            duration = Math.round((end.getTime() - start.getTime()) / 60000);
          } else if (e.start?.date && e.end?.date) {
            // All-day event: count as 8 hours per day
            const start = new Date(e.start.date);
            const end = new Date(e.end.date);
            const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
            duration = days * 480; // 8 hours per day
          }

          // Extract attendee domains (external only)
          const attendeeDomains = new Set<string>();
          for (const a of e.attendees || []) {
            const email = a.email || "";
            const d = email.split("@")[1];
            if (d && d !== userDomain && !d.includes("calendar.google.com")) {
              attendeeDomains.add(d);
            }
          }

          // Also discover SaaS tools from attendee domains
          for (const d of attendeeDomains) {
            const app = lookupDomain(d);
            if (app && !discoveredApps.has(app.name)) {
              discoveredApps.set(app.name, { app, emailCount: 0, categories: new Set(), amounts: [] });
            }
          }

          // Detect conference tool
          let conferenceType: string | null = null;
          const confData = e.conferenceData;
          if (confData?.conferenceSolution?.name) {
            conferenceType = confData.conferenceSolution.name;
          } else if (e.hangoutLink) {
            conferenceType = "Google Meet";
          } else if (e.location?.includes("zoom.us")) {
            conferenceType = "Zoom";
          } else if (e.description?.includes("teams.microsoft.com")) {
            conferenceType = "Microsoft Teams";
          }

          // Detect recurring (approximation: check if same title repeats)
          const isRecurring = !!e.recurringEventId;

          // Extract my response status from attendees
          let myResponseStatus: CalendarEvent["myResponseStatus"] = "unknown";
          for (const a of e.attendees || []) {
            if (a.self) {
              const rs = a.responseStatus || "unknown";
              if (rs === "accepted" || rs === "declined" || rs === "tentative" || rs === "needsAction") {
                myResponseStatus = rs;
              }
              break;
            }
          }

          allCalendarEvents.push({
            summary: e.summary || "(no title)",
            date: e.start?.dateTime || e.start?.date || "",
            duration,
            attendeeCount: e.attendees?.length || 0,
            externalDomains: [...attendeeDomains],
            isRecurring,
            conferenceType,
            organizer: e.organizer?.email || "",
            myResponseStatus,
            recurringEventId: e.recurringEventId || null,
          });
        }

        // Calendar stats
        const recurring = allCalendarEvents.filter((e) => e.isRecurring);
        const withExternal = allCalendarEvents.filter((e) => e.externalDomains.length > 0);
        const totalMeetingHours = Math.round(allCalendarEvents.reduce((s, e) => s + e.duration, 0) / 60);
        const confTools = new Set(allCalendarEvents.map((e) => e.conferenceType).filter(Boolean));

        send({ type: "agent-log", agent: "Signal", message: `${events.length} events analyzed. ${recurring.length} recurring. ${withExternal.length} with external attendees. ${totalMeetingHours}h total meeting time. Video tools: ${[...confTools].join(", ") || "none detected"}`, logType: "discovery" });

        // Meeting type classification
        const meetingTypes: Record<string, number> = {
          standup: 0, oneOnOne: 0, review: 0, demo: 0, interview: 0,
          sync: 0, sales: 0, planning: 0, retro: 0, kickoff: 0, allHands: 0,
        };
        for (const e of allCalendarEvents) {
          const s = e.summary.toLowerCase();
          if (/standup|daily\b/.test(s)) meetingTypes.standup++;
          else if (/\b1[:\s]?(on|:)?[:\s]?1\b|1-1|one.on.one|\/\/|check[- ]?in/.test(s)) meetingTypes.oneOnOne++;
          else if (/review|feedback|critique/.test(s)) meetingTypes.review++;
          else if (/demo|walkthrough/.test(s)) meetingTypes.demo++;
          else if (/interview|screen|phone screen|candidate/.test(s)) meetingTypes.interview++;
          else if (/sync|sync[- ]up|catch[- ]?up/.test(s)) meetingTypes.sync++;
          else if (/sales|pitch|discovery|prospect/.test(s)) meetingTypes.sales++;
          else if (/planning|roadmap|sprint plan/.test(s)) meetingTypes.planning++;
          else if (/retro|retrospective|post[- ]?mortem/.test(s)) meetingTypes.retro++;
          else if (/kickoff|kick[- ]?off|kick off/.test(s)) meetingTypes.kickoff++;
          else if (/all[- ]?hands|town ?hall|company meeting/.test(s)) meetingTypes.allHands++;
        }

        // Back-to-back meeting detection (no buffer between)
        const sortedEvents = [...allCalendarEvents]
          .filter((e) => e.duration > 0)
          .map((e) => ({ ...e, start: new Date(e.date), end: new Date(new Date(e.date).getTime() + e.duration * 60000) }))
          .sort((a, b) => a.start.getTime() - b.start.getTime());
        let backToBack = 0;
        for (let i = 1; i < sortedEvents.length; i++) {
          const prev = sortedEvents[i - 1];
          const curr = sortedEvents[i];
          const gapMinutes = (curr.start.getTime() - prev.end.getTime()) / 60000;
          // Same day and gap < 5 minutes
          if (gapMinutes >= 0 && gapMinutes < 5 && prev.end.toDateString() === curr.start.toDateString()) {
            backToBack++;
          }
        }

        calMeetingTypes = meetingTypes;
        calBackToBack = backToBack;

        // Response status counts
        for (const e of allCalendarEvents) {
          if (e.myResponseStatus === "declined") calDeclined++;
          else if (e.myResponseStatus === "accepted") calAccepted++;
          else if (e.myResponseStatus === "tentative") calTentative++;
        }

        // Meeting hours per week (avg over 26 weeks)
        const totalMeetingMinutes = allCalendarEvents.reduce((s, e) => s + e.duration, 0);
        calMeetingHoursPerWeek = Math.round((totalMeetingMinutes / 60) / 26 * 10) / 10;

        // Top recurring meetings by total time consumed
        // Group by recurringEventId, compute aggregate stats
        const recurringGroups = new Map<string, { title: string; occurrences: number; totalMinutes: number; totalAttendees: number }>();
        for (const e of allCalendarEvents) {
          if (!e.recurringEventId) continue;
          if (!recurringGroups.has(e.recurringEventId)) {
            recurringGroups.set(e.recurringEventId, { title: e.summary, occurrences: 0, totalMinutes: 0, totalAttendees: 0 });
          }
          const g = recurringGroups.get(e.recurringEventId)!;
          g.occurrences++;
          g.totalMinutes += e.duration;
          g.totalAttendees += e.attendeeCount;
        }
        calTopRecurring = [...recurringGroups.values()]
          .filter((g) => g.occurrences >= 3 && g.totalMinutes >= 60)
          .sort((a, b) => b.totalMinutes - a.totalMinutes)
          .slice(0, 8)
          .map((g) => ({
            title: g.title,
            occurrences: g.occurrences,
            totalMinutes: g.totalMinutes,
            attendeeAvg: Math.round(g.totalAttendees / g.occurrences),
          }));

        // Focus time: count gaps >= 2 hours between meetings during weekday workday (9-5)
        // as available deep work time
        const eventsByDay = new Map<string, Array<{ start: Date; end: Date }>>();
        for (const e of sortedEvents) {
          const dayKey = e.start.toDateString();
          if (!eventsByDay.has(dayKey)) eventsByDay.set(dayKey, []);
          eventsByDay.get(dayKey)!.push({ start: e.start, end: e.end });
        }
        let totalFocusMinutes = 0;
        let weekdayCount = 0;
        const dayHours = new Map<string, number>();
        for (const [dayKey, dayEvents] of eventsByDay) {
          const d = new Date(dayKey);
          if (d.getDay() === 0 || d.getDay() === 6) continue; // skip weekends
          weekdayCount++;
          // Workday window 9am-5pm = 480 min
          const workdayStart = new Date(d);
          workdayStart.setHours(9, 0, 0, 0);
          const workdayEnd = new Date(d);
          workdayEnd.setHours(17, 0, 0, 0);
          // Sum meeting time within workday window
          let meetingMinsToday = 0;
          for (const evt of dayEvents) {
            const overlapStart = new Date(Math.max(evt.start.getTime(), workdayStart.getTime()));
            const overlapEnd = new Date(Math.min(evt.end.getTime(), workdayEnd.getTime()));
            if (overlapEnd.getTime() > overlapStart.getTime()) {
              meetingMinsToday += (overlapEnd.getTime() - overlapStart.getTime()) / 60000;
            }
          }
          const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
          dayHours.set(dayName, (dayHours.get(dayName) || 0) + meetingMinsToday / 60);
          // Available focus = 480 min workday - meeting minutes
          const focusMins = Math.max(0, 480 - meetingMinsToday);
          totalFocusMinutes += focusMins;
        }
        calFocusTimeHours = weekdayCount > 0 ? Math.round(totalFocusMinutes / 60 / weekdayCount * 10) / 10 : 0;

        // Heaviest meeting day (averaged)
        if (dayHours.size > 0) {
          // Count weekdays of each name to compute avg
          const dayCount = new Map<string, number>();
          for (const dayKey of eventsByDay.keys()) {
            const dn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(dayKey).getDay()];
            dayCount.set(dn, (dayCount.get(dn) || 0) + 1);
          }
          const avgDayHours = [...dayHours.entries()].map(([day, hrs]) => ({
            day,
            hours: Math.round((hrs / (dayCount.get(day) || 1)) * 10) / 10,
          })).sort((a, b) => b.hours - a.hours);
          if (avgDayHours.length > 0) calHeaviestMeetingDay = avgDayHours[0];
        }

      } catch (err) {
        send({ type: "agent-log", agent: "Signal", message: `Calendar: ${err instanceof Error ? err.message.slice(0, 60) : "denied"}`, logType: "progress" });
      }

      send({ type: "progress", records: 100, scanned: 50, message: `Crawl complete. ${totalItems} items. Building intelligence model...` });

      // ═══════════════════════════════════════
      // ADMIN-ONLY: User directory
      // ═══════════════════════════════════════
      const adminUsers: { email: string; name: string; lastLogin: string; suspended: boolean; isAdmin: boolean; orgUnit: string }[] = [];
      if (isAdmin) {
        try {
          const admin = google.admin({ version: "directory_v1", auth: oauth2Client });
          const usersRes = await admin.users.list({ customer: "my_customer", maxResults: 500 });
          const users = usersRes.data.users || [];
          orgUserCount = users.length;
          send({ type: "agent-log", agent: "Scout", message: `Organization has ${orgUserCount} users`, logType: "discovery" });

          const inactive = users.filter((u) => {
            const last = u.lastLoginTime ? new Date(u.lastLoginTime) : null;
            return last && last < new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) && !u.suspended;
          });
          send({ type: "agent-log", agent: "Scout", message: `${inactive.length} users inactive 90+ days`, logType: "discovery" });

          for (const u of users) {
            adminUsers.push({
              email: u.primaryEmail || "",
              name: u.name?.fullName || "",
              lastLogin: u.lastLoginTime || "",
              suspended: !!u.suspended,
              isAdmin: !!u.isAdmin,
              orgUnit: u.orgUnitPath || "",
            });
          }
        } catch {
          send({ type: "agent-log", agent: "Scout", message: "Admin Directory not accessible. Using email-based estimation.", logType: "progress" });
        }
      }

      // ═══════════════════════════════════════
      // ORG SIZE ESTIMATION from email addresses
      // ═══════════════════════════════════════
      if (orgUserCount === 0 && userDomain) {
        const internalAddresses = new Set<string>();
        for (const email of allEmailMeta) {
          if (email.from.endsWith(`@${userDomain}`)) internalAddresses.add(email.from);
          for (const addr of [...email.to, ...email.cc]) {
            if (addr.endsWith(`@${userDomain}`)) internalAddresses.add(addr);
          }
        }
        orgUserCount = Math.max(internalAddresses.size, 1);
        send({ type: "agent-log", agent: "Scout", message: `Estimated org size: ${orgUserCount} unique ${userDomain} addresses`, logType: "discovery" });
      }
      if (orgUserCount === 0) orgUserCount = 1; // Solo user

      // ═══════════════════════════════════════
      // COMMUNICATION GRAPH PRE-PROCESSING
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Atlas", message: "Building communication graph and workflow patterns...", logType: "analysis" });

      // Build sender/recipient frequency map
      const commNodes = new Map<string, CommGraphNode>();
      const pairFreq = new Map<string, number>(); // "a@x.com->b@y.com" => count

      for (const email of allEmailMeta) {
        const fromAddr = email.from;
        if (!fromAddr) continue;
        const fromDomain = fromAddr.split("@")[1] || "";
        const isInternal = fromDomain === userDomain;

        // Skip automated/noreply senders for comm graph (they're noise)
        const senderLocal = fromAddr.split("@")[0] || "";
        if (/^(noreply|no-reply|notifications|mailer|bounce|donotreply|updates|news|newsletter)$/i.test(senderLocal)) continue;

        // Track node
        if (!commNodes.has(fromAddr)) {
          commNodes.set(fromAddr, { email: fromAddr, domain: fromDomain, sent: 0, received: 0, isInternal });
        }
        commNodes.get(fromAddr)!.sent++;

        for (const toAddr of [...email.to, ...email.cc]) {
          if (!toAddr) continue;
          const toDomain = toAddr.split("@")[1] || "";
          if (!commNodes.has(toAddr)) {
            commNodes.set(toAddr, { email: toAddr, domain: toDomain, sent: 0, received: 0, isInternal: toDomain === userDomain });
          }
          commNodes.get(toAddr)!.received++;

          // Track pair frequency (internal only for workflow detection)
          if (isInternal && toDomain === userDomain) {
            const key = `${fromAddr}->${toAddr}`;
            pairFreq.set(key, (pairFreq.get(key) || 0) + 1);
          }
        }
      }

      // Top internal communicators
      const internalNodes = [...commNodes.values()].filter((n) => n.isInternal).sort((a, b) => (b.sent + b.received) - (a.sent + a.received));
      const externalDomainCount = new Set([...commNodes.values()].filter((n) => !n.isInternal).map((n) => n.domain)).size;

      // Forward ratio per person (high forward ratio = human middleware)
      const forwardsByPerson = new Map<string, number>();
      const totalByPerson = new Map<string, number>();
      for (const email of allEmailMeta) {
        totalByPerson.set(email.from, (totalByPerson.get(email.from) || 0) + 1);
        if (email.isForward) {
          forwardsByPerson.set(email.from, (forwardsByPerson.get(email.from) || 0) + 1);
        }
      }

      const humanMiddleware = [...forwardsByPerson.entries()]
        .map(([email, fwds]) => ({ email, fwds, total: totalByPerson.get(email) || 0, ratio: fwds / (totalByPerson.get(email) || 1) }))
        .filter((p) => p.ratio > 0.3 && p.total > 5)
        .sort((a, b) => b.ratio - a.ratio);

      // Thread depth analysis
      const threadCounts = new Map<string, number>();
      for (const email of allEmailMeta) {
        if (email.threadId) {
          threadCounts.set(email.threadId, (threadCounts.get(email.threadId) || 0) + 1);
        }
      }
      const deepThreads = [...threadCounts.entries()].filter(([, count]) => count >= 5).sort((a, b) => b[1] - a[1]);

      // ═══════════════════════════════════════
      // AFTER-HOURS WORK DETECTION
      // Emails the user SENT during nights/weekends reveal work-life pattern
      // ═══════════════════════════════════════
      let afterHoursCount = 0;
      let weekendCount = 0;
      let totalUserSends = 0;
      const sendHourHistogram: number[] = new Array(24).fill(0);
      for (const email of allEmailMeta) {
        // Only count emails the user themselves sent (from their own domain)
        if (!email.from.endsWith(`@${userDomain || "___NONE___"}`)) continue;
        const d = new Date(email.date);
        if (isNaN(d.getTime())) continue;
        totalUserSends++;
        const hour = d.getHours();
        const dow = d.getDay();
        sendHourHistogram[hour]++;
        if (hour < 7 || hour >= 20) afterHoursCount++;
        if (dow === 0 || dow === 6) weekendCount++;
      }
      const afterHoursPct = totalUserSends > 0 ? Math.round((afterHoursCount / totalUserSends) * 100) : 0;
      const weekendPct = totalUserSends > 0 ? Math.round((weekendCount / totalUserSends) * 100) : 0;
      // Find peak send hour
      const peakHour = sendHourHistogram.indexOf(Math.max(...sendHourHistogram));

      // ═══════════════════════════════════════
      // REPLY LATENCY ANALYSIS
      // How fast the user responds to inbound emails
      // ═══════════════════════════════════════
      // Build thread timelines: for each thread, find incoming + outgoing + time deltas
      const threadTimelines = new Map<string, { date: Date; isFromUser: boolean }[]>();
      for (const email of allEmailMeta) {
        if (!email.threadId) continue;
        const d = new Date(email.date);
        if (isNaN(d.getTime())) continue;
        const isFromUser = userDomain ? email.from.endsWith(`@${userDomain}`) : false;
        if (!threadTimelines.has(email.threadId)) threadTimelines.set(email.threadId, []);
        threadTimelines.get(email.threadId)!.push({ date: d, isFromUser });
      }
      const replyLatenciesMinutes: number[] = [];
      for (const [, timeline] of threadTimelines) {
        timeline.sort((a, b) => a.date.getTime() - b.date.getTime());
        for (let i = 1; i < timeline.length; i++) {
          const prev = timeline[i - 1];
          const curr = timeline[i];
          if (!prev.isFromUser && curr.isFromUser) {
            const mins = (curr.date.getTime() - prev.date.getTime()) / 60000;
            if (mins > 0 && mins < 60 * 24 * 7) replyLatenciesMinutes.push(mins);
          }
        }
      }
      replyLatenciesMinutes.sort((a, b) => a - b);
      const medianReplyMins = replyLatenciesMinutes.length > 0
        ? replyLatenciesMinutes[Math.floor(replyLatenciesMinutes.length / 2)]
        : 0;
      const fastReplies = replyLatenciesMinutes.filter((m) => m < 15).length;
      const slowReplies = replyLatenciesMinutes.filter((m) => m > 60 * 24).length;

      // ═══════════════════════════════════════
      // ATTACHMENT FILENAME PATTERNS
      // (We have hasAttachment bit but Gmail metadata doesn't give filenames without full reads.
      // Use subject patterns as proxy for repeated document flows.)
      // ═══════════════════════════════════════
      const subjectPatterns = new Map<string, number>();
      const docKeywords = /\b(invoice|receipt|contract|report|proposal|statement|quote|po[\s-#]|purchase[\s_-]order|expense|reimbursement|pitch|deck|w[-\s]?[92]|nda|msa|sow|estimate)\b/i;
      for (const email of allEmailMeta) {
        if (!email.hasAttachment) continue;
        const match = email.subject.toLowerCase().match(docKeywords);
        if (match) {
          const key = match[0].toLowerCase().replace(/\s+/g, "_");
          subjectPatterns.set(key, (subjectPatterns.get(key) || 0) + 1);
        }
      }
      const topDocPatterns = [...subjectPatterns.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .filter(([, count]) => count >= 2);

      // ═══════════════════════════════════════
      // CADENCE & WORKFLOW PATTERN DETECTION
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Signal", message: "Detecting recurring email cadences and workflow patterns...", logType: "analysis" });

      const cadencePatterns: CadencePattern[] = [];

      // Group emails by sender + normalized subject
      const normalizeSubject = (s: string) => s.replace(/^(re:|fw:|fwd:)\s*/gi, "").replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, "DATE").replace(/\d{4}-\d{2}-\d{2}/g, "DATE").replace(/#\d+/g, "#N").replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/gi, "MONTH").replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/gi, "DAY").replace(/week\s*\d+/gi, "WEEK_N").trim();

      const senderSubjectGroups = new Map<string, { dates: Date[]; subjects: string[]; recipients: Set<string> }>();

      // Known automated/noreply domains to exclude from cadence detection
      const automatedPrefixes = /^(noreply|no-reply|notifications|mailer|bounce|donotreply|updates|news|newsletter|alert|digest)/i;

      for (const email of allEmailMeta) {
        if (!email.from || !email.subject) continue;
        // Skip replies and forwards (we want original sends, not chain responses)
        if (email.isReply || email.isForward) continue;
        // Skip automated/noreply senders
        const senderLocal = email.from.split("@")[0] || "";
        if (automatedPrefixes.test(senderLocal)) continue;
        // Only include senders from the org domain (internal processes)
        // or keep external if org domain is unknown (personal gmail)
        if (userDomain && email.domain !== userDomain) continue;

        const key = `${email.from}::${normalizeSubject(email.subject)}`;
        if (!senderSubjectGroups.has(key)) {
          senderSubjectGroups.set(key, { dates: [], subjects: [], recipients: new Set() });
        }
        const group = senderSubjectGroups.get(key)!;
        const d = new Date(email.date);
        if (!isNaN(d.getTime())) group.dates.push(d);
        if (group.subjects.length < 5) group.subjects.push(email.subject);
        for (const r of [...email.to, ...email.cc]) group.recipients.add(r);
      }

      // Detect recurring patterns (3+ occurrences with regular intervals)
      for (const [key, group] of senderSubjectGroups) {
        if (group.dates.length < 3) continue;

        group.dates.sort((a, b) => a.getTime() - b.getTime());
        const intervals = [];
        for (let i = 1; i < group.dates.length; i++) {
          intervals.push((group.dates[i].getTime() - group.dates[i - 1].getTime()) / (1000 * 60 * 60 * 24));
        }

        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const stdDev = Math.sqrt(intervals.reduce((sum, i) => sum + (i - avgInterval) ** 2, 0) / intervals.length);

        // Only flag as cadence if intervals are somewhat regular (stdDev < 50% of avg)
        if (avgInterval > 0 && stdDev < avgInterval * 0.6) {
          let frequency = "ad-hoc";
          if (avgInterval <= 1.5) frequency = "daily";
          else if (avgInterval <= 4) frequency = "every few days";
          else if (avgInterval <= 9) frequency = "weekly";
          else if (avgInterval <= 18) frequency = "biweekly";
          else if (avgInterval <= 45) frequency = "monthly";
          else if (avgInterval <= 100) frequency = "quarterly";

          // Determine most common day of week
          const dayCounts = [0, 0, 0, 0, 0, 0, 0];
          for (const d of group.dates) dayCounts[d.getDay()]++;
          const peakDay = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayCounts.indexOf(Math.max(...dayCounts))];

          const sender = key.split("::")[0];
          cadencePatterns.push({
            sender,
            subjectPattern: normalizeSubject(group.subjects[0]),
            frequency,
            dayOfWeek: peakDay,
            recipientCount: group.recipients.size,
            exampleSubjects: group.subjects.slice(0, 3),
            count: group.dates.length,
          });
        }
      }

      cadencePatterns.sort((a, b) => b.count - a.count);

      // Attachment-heavy threads (spreadsheets being emailed = manual data process)
      const attachmentEmails = allEmailMeta.filter((e) => e.hasAttachment);
      const attachmentThreads = new Map<string, number>();
      for (const e of attachmentEmails) {
        if (e.threadId) attachmentThreads.set(e.threadId, (attachmentThreads.get(e.threadId) || 0) + 1);
      }
      const heavyAttachmentThreads = [...attachmentThreads.entries()].filter(([, c]) => c >= 2).length;

      send({ type: "agent-log", agent: "Signal", message: `Detected ${cadencePatterns.length} recurring email cadences. ${humanMiddleware.length} potential human middleware. ${heavyAttachmentThreads} attachment-heavy threads.`, logType: "discovery" });

      send({ type: "progress", records: 100, scanned: 55, message: `Intelligence model built. Calculating costs...` });

      // ═══════════════════════════════════════
      // COST INTELLIGENCE
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Atlas", message: "Building cost model from discovered apps...", logType: "analysis" });

      type TechStackEntry = { name: string; category: string; emailCount: number; estimatedAnnualCost: { low: number; mid: number; high: number } | null; actualAmounts: number[]; pricingModel: string };
      const techStack: TechStackEntry[] = [];
      let totalEstimatedSpendMid = 0;

      for (const [name, data] of discoveredApps) {
        const cost = estimateAnnualCost(data.app, orgUserCount, data.emailCount);
        if (cost) totalEstimatedSpendMid += cost.mid;
        techStack.push({
          name,
          category: data.app.category,
          emailCount: data.emailCount,
          estimatedAnnualCost: cost,
          actualAmounts: data.amounts.slice(0, 20),
          pricingModel: data.app.pricingModel,
        });
      }

      techStack.sort((a, b) => (b.estimatedAnnualCost?.mid || 0) - (a.estimatedAnnualCost?.mid || 0));

      // Build UI-facing tech stack with honest cost labels
      let totalActualSpend = 0;
      const techStackForUI = techStack.slice(0, 50).map((t) => {
        const hasActualAmounts = t.actualAmounts.length > 0;
        const actualTotal = t.actualAmounts.reduce((a, b) => a + b, 0);
        if (hasActualAmounts && actualTotal > 0) {
          totalActualSpend += actualTotal;
          return {
            name: t.name, category: t.category,
            estimatedCost: formatCost(actualTotal) + "/yr", costSource: "invoice" as const,
            emailActivity: t.emailCount, actualAmounts: t.actualAmounts.slice(0, 5),
          };
        }
        return {
          name: t.name, category: t.category,
          estimatedCost: t.estimatedAnnualCost ? "~" + formatCost(t.estimatedAnnualCost.mid) + "/yr" : "usage-based",
          costSource: t.estimatedAnnualCost ? "estimate" as const : "unknown" as const,
          emailActivity: t.emailCount, actualAmounts: [] as number[],
        };
      });

      const displaySpend = totalActualSpend > 0
        ? formatCost(totalActualSpend)
        : (totalEstimatedSpendMid > 0 ? "~" + formatCost(totalEstimatedSpendMid) + " (est.)" : "unknown");

      send({
        type: "techStack",
        apps: techStackForUI,
        totalEstimatedSpend: displaySpend,
        appCount: techStack.length,
        userCount: orgUserCount,
      });

      // ═══════════════════════════════════════
      // SEND ORG INTELLIGENCE TO FRONTEND
      // Rich data the UI can use for the "magic" reveal
      // ═══════════════════════════════════════
      const totalMeetingHours = Math.round(allCalendarEvents.reduce((s, e) => s + e.duration, 0) / 60);
      const recurringEvents = allCalendarEvents.filter((e) => e.isRecurring);
      const externalMeetings = allCalendarEvents.filter((e) => e.externalDomains.length > 0);
      const confToolSet = new Set(allCalendarEvents.map((e) => e.conferenceType).filter(Boolean));
      const sharedSpreadsheetCount = allDriveFiles.filter((f) => f.category === "spreadsheet" && f.shared).length;

      // Top external vendors by meeting frequency
      const vendorMeetingCounts = new Map<string, number>();
      for (const e of allCalendarEvents) {
        for (const d of e.externalDomains) vendorMeetingCounts.set(d, (vendorMeetingCounts.get(d) || 0) + 1);
      }
      const topVendorMeetings = [...vendorMeetingCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

      // Top internal communicators
      const topCommunicators = internalNodes.slice(0, 5).map((n) => ({
        email: n.email,
        sent: n.sent,
        received: n.received,
        total: n.sent + n.received,
      }));

      // Top external senders (vendors, partners, services)
      // More useful for personal scans where "top communicator" is always you
      const externalNodes = [...commNodes.values()]
        .filter((n) => !n.isInternal && n.sent > 0)
        .sort((a, b) => b.sent - a.sent)
        .slice(0, 8);
      const topExternalSenders = externalNodes.map((n) => ({
        email: n.email,
        domain: n.domain,
        count: n.sent,
      }));

      // Top recurring cadences for display
      const topCadences = cadencePatterns.slice(0, 8).map((p) => ({
        sender: p.sender,
        pattern: p.exampleSubjects[0] || p.subjectPattern,
        frequency: p.frequency,
        dayOfWeek: p.dayOfWeek,
        recipients: p.recipientCount,
        occurrences: p.count,
      }));

      const orgIntelData = {
        emailsAnalyzed: allEmailMeta.length,
        financialEmails: allFinancialEmails.length,
        calendarEvents: allCalendarEvents.length,
        driveDocuments: allDriveFiles.length,
        orgDomain: userDomain,
        orgSize: orgUserCount,
        internalContacts: internalNodes.length,
        externalDomains: externalDomainCount,
        meetingHours6mo: totalMeetingHours,
        recurringMeetings: recurringEvents.length,
        externalMeetings: externalMeetings.length,
        videoTools: [...confToolSet],
        sharedSpreadsheets: sharedSpreadsheetCount,
        humanMiddleware: humanMiddleware.slice(0, 3).map((h) => ({ email: h.email, forwardRatio: Math.round(h.ratio * 100) })),
        topCommunicators,
        topVendorMeetings: topVendorMeetings.map(([domain, count]) => ({ domain, meetings: count })),
        recurringProcesses: topCadences,
        deepThreads: deepThreads.length,
        attachmentThreads: heavyAttachmentThreads,
        gmailLabels: gmailLabels.slice(0, 20),
        roleInboxes: [...roleInboxes].slice(0, 10),
        topExternalSenders,
        afterHoursPct,
        weekendPct,
        peakHour,
        medianReplyMins,
        fastReplies,
        slowReplies,
        totalUserSends,
        docPatterns: topDocPatterns.map(([name, count]) => ({ name, count })),
        meetingHoursPerWeek: calMeetingHoursPerWeek,
        focusTimePerWeekday: calFocusTimeHours,
        meetingsAccepted: calAccepted,
        meetingsDeclined: calDeclined,
        meetingsTentative: calTentative,
        backToBackMeetings: calBackToBack,
        heaviestMeetingDay: calHeaviestMeetingDay,
        topStandingMeetings: calTopRecurring,
      };
      send({ type: "orgIntelligence", ...orgIntelData });

      send({ type: "progress", records: 100, scanned: 65, message: `Cost model: ${displaySpend}/yr across ${techStack.length} tools. Running Opus deep analysis...` });

      // ═══════════════════════════════════════
      // BUILD STRUCTURED INTELLIGENCE BRIEFING FOR OPUS
      // ═══════════════════════════════════════

      const techStackSummary = techStack.map((t) => {
        const cost = t.estimatedAnnualCost;
        const costStr = cost ? `${formatCost(cost.low)}-${formatCost(cost.high)}/yr (mid: ${formatCost(cost.mid)})` : "usage-based";
        const actualStr = t.actualAmounts.length > 0 ? `. Invoiced: ${t.actualAmounts.map((a) => "$" + a.toFixed(2)).join(", ")}` : "";
        return `- ${t.name} (${t.category}): ${t.pricingModel}, est. ${costStr}, ${t.emailCount} emails${actualStr}`;
      }).join("\n");

      // Communication graph summary
      const commGraphSummary = [
        `Organization domain: ${userDomain || "unknown"}`,
        `Estimated org size: ${orgUserCount} users`,
        `Internal addresses seen: ${internalNodes.length}`,
        `External domains communicated with: ${externalDomainCount}`,
        `Top internal communicators (by volume):`,
        ...internalNodes.slice(0, 10).map((n) => `  - ${n.email}: ${n.sent} sent, ${n.received} received`),
        `\nTop communication pairs:`,
        ...[...pairFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([pair, count]) => `  - ${pair}: ${count} emails`),
        `\nHuman middleware candidates (high forward ratio):`,
        ...(humanMiddleware.length > 0
          ? humanMiddleware.slice(0, 5).map((p) => `  - ${p.email}: ${p.fwds}/${p.total} emails forwarded (${Math.round(p.ratio * 100)}% forward ratio)`)
          : ["  - None detected"]),
        `\nDeep threads (5+ emails in chain):`,
        ...(deepThreads.length > 0
          ? [`  - ${deepThreads.length} threads with 5+ messages. Deepest: ${deepThreads[0]?.[1] || 0} messages`]
          : ["  - None"]),
        `\nAttachment patterns:`,
        `  - ${attachmentEmails.length} emails with attachments`,
        `  - ${heavyAttachmentThreads} threads with 2+ attachments (potential manual data exchange)`,
        ...(topDocPatterns.length > 0 ? [`  - Document types in subjects: ${topDocPatterns.map(([n, c]) => `${n}(${c})`).join(", ")}`] : []),
        `\nWork patterns:`,
        `  - User sent ${totalUserSends} emails`,
        `  - ${afterHoursPct}% sent after-hours (before 7am or after 8pm)`,
        `  - ${weekendPct}% sent on weekends`,
        `  - Peak sending hour: ${peakHour}:00`,
        `\nResponse behavior:`,
        `  - Median reply time: ${medianReplyMins < 60 ? Math.round(medianReplyMins) + " min" : Math.round(medianReplyMins / 60) + " hrs"}`,
        `  - ${fastReplies} replies within 15 min (interruption-driven)`,
        `  - ${slowReplies} replies took 24+ hours (batch processing)`,
        ...(gmailLabels.length > 0 ? [`\nGmail labels (user-created):`, `  - ${gmailLabels.join(", ")}`] : []),
        ...(roleInboxes.size > 0 ? [`\nRole inboxes detected:`, `  - ${[...roleInboxes].join(", ")}`] : []),
      ].join("\n");

      // Cadence patterns summary
      const cadenceSummary = cadencePatterns.length > 0
        ? cadencePatterns.slice(0, 20).map((p) => `- ${p.sender} sends "${p.exampleSubjects[0]}" ${p.frequency} (${p.count} occurrences, usually ${p.dayOfWeek}, to ${p.recipientCount} people)`).join("\n")
        : "No regular cadence patterns detected.";

      // Calendar intelligence
      const calendarSummary = (() => {
        if (allCalendarEvents.length === 0) return "No calendar data available.";
        const totalHours = Math.round(allCalendarEvents.reduce((s, e) => s + e.duration, 0) / 60);
        const recurring = allCalendarEvents.filter((e) => e.isRecurring);
        const withExternal = allCalendarEvents.filter((e) => e.externalDomains.length > 0);
        const confTools = new Map<string, number>();
        for (const e of allCalendarEvents) {
          if (e.conferenceType) confTools.set(e.conferenceType, (confTools.get(e.conferenceType) || 0) + 1);
        }
        // External vendor domains from calendar
        const calVendorDomains = new Map<string, number>();
        for (const e of allCalendarEvents) {
          for (const d of e.externalDomains) {
            calVendorDomains.set(d, (calVendorDomains.get(d) || 0) + 1);
          }
        }
        const topVendorMeetings = [...calVendorDomains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

        return [
          `Total events: ${allCalendarEvents.length} (${totalHours}h total meeting time over 6 months)`,
          `Recurring events: ${recurring.length}`,
          `Events with external attendees: ${withExternal.length}`,
          `Video tools: ${[...confTools.entries()].map(([t, c]) => `${t}(${c})`).join(", ") || "none"}`,
          `Back-to-back meetings (no buffer): ${calBackToBack}`,
          `Meeting hours per week: ${calMeetingHoursPerWeek}h`,
          `Avg focus time per weekday: ${calFocusTimeHours}h (out of 8)`,
          `Meetings declined: ${calDeclined}`,
          `Meetings accepted: ${calAccepted}`,
          `Heaviest meeting day: ${calHeaviestMeetingDay.day || "n/a"} (${calHeaviestMeetingDay.hours}h avg)`,
          `\nTop standing meetings by total time consumed (over 6 months):`,
          ...calTopRecurring.slice(0, 8).map((m) => `  - "${m.title}" — ${m.occurrences}× · ${Math.round(m.totalMinutes / 60 * 10) / 10}h total · avg ${m.attendeeAvg} attendees`),
          `\nMeeting type breakdown:`,
          ...Object.entries(calMeetingTypes).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([t, c]) => `  - ${t}: ${c}`),
          `\nTop external domains in calendar (vendor relationships):`,
          ...topVendorMeetings.map(([d, c]) => `  - ${d}: ${c} meetings`),
          `\nRecurring meetings with external attendees:`,
          ...withExternal.filter((e) => e.isRecurring).slice(0, 12).map((e) => `  - "${e.summary}" with ${e.externalDomains.join(", ")} (${e.attendeeCount} attendees, ${e.duration}min)`),
        ].join("\n");
      })();

      // Drive intelligence
      const driveSummary = (() => {
        if (allDriveFiles.length === 0) return "No Drive data available.";
        const shared = allDriveFiles.filter((f) => f.shared);
        const spreadsheets = allDriveFiles.filter((f) => f.category === "spreadsheet");
        const sharedSpreadsheets = spreadsheets.filter((f) => f.shared);
        return [
          `Total documents: ${allDriveFiles.length}`,
          `Shared files: ${shared.length}`,
          `Spreadsheets: ${spreadsheets.length} (${sharedSpreadsheets.length} shared externally)`,
          `\nContracts/agreements: ${allDriveFiles.filter((f) => f.category === "contracts").length}`,
          `Procurement docs: ${allDriveFiles.filter((f) => f.category === "procurement").length}`,
          `Finance docs: ${allDriveFiles.filter((f) => f.category === "finance").length}`,
          ...(sharedSpreadsheets.length > 0 ? [
            `\nShared spreadsheets (potential manual data exchange):`,
            ...sharedSpreadsheets.slice(0, 10).map((f) => `  - "${f.name}" (shared with ${f.sharedWith} people, last modified ${f.modified})`),
          ] : []),
        ].join("\n");
      })();

      // ═══════════════════════════════════════
      // AGENT 5: ATLAS — Opus Deep Analysis
      // Restructured prompt with real structured signals
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Atlas", message: "Running Opus deep analysis with structured intelligence...", logType: "analysis" });

      const prompt = `You are UpSkiller AI's Atlas agent. You have completed a scan of a single user's Google Workspace inbox. Your job is to produce findings that are IMMEDIATELY useful and HONEST.

## CRITICAL CONTEXT: WHAT YOU DO AND DO NOT KNOW

**You scanned ONE inbox** (the signed-in user's own email). You do NOT have:
- Actual SaaS subscription costs (unless shown in invoice emails below)
- The organization's real budget or revenue
- Visibility into other employees' inboxes
- Actual seat counts for any tool
- Contract terms, expiration dates (unless explicitly in email body)
- Vendor usage data (logins, active users)

**What you DO know** comes only from: this one inbox's email headers, financial email bodies, calendar events visible to this user, and Drive metadata.

${isAdmin ? "" : `**THIS IS A PERSONAL/SINGLE-USER SCAN.** Statements like "X handles 94% of communications" are meaningless because we only see their inbox. Do NOT make claims about organizational communication patterns, key person risk, or workflow bottlenecks based on this single-inbox data. Those require admin-level access to multiple inboxes.`}

## RULES (VIOLATE = BAD FINDING)

1. **No invented numbers.** If an invoice shows $22,000, that's real. If you say "annual SaaS budget is $7K", that's invented — we don't know their budget.
2. **No percentage claims about "all communication" or "the org".** We only see one inbox.
3. **Don't propose automating things that aren't automatable.** Negotiations, strategic decisions, relationship management: NOT automatable. Data entry, recurring reports, notifications, receipt processing: automatable.
4. **Evidence must be citable.** If you can't point to a specific email subject, sender, date, or amount from the data below, don't claim it.
5. **Silent on unknowns.** If you can't tell license waste without usage data, say so and recommend connecting a specific system to find out.

## ORGANIZATION PROFILE (from scan)
- User domain: ${userDomain || "personal gmail"}
- Est. internal addresses in this inbox: ${orgUserCount}
- SaaS tools detected by email domain: ${techStack.length}
- Items analyzed: ${totalItems} (emails, files, events from ONE inbox)
- Scan mode: ${isAdmin ? "ADMIN (multi-inbox)" : "PERSONAL (single inbox)"}

## DISCOVERED TECH STACK WITH PRICING
${techStackSummary}

## COMMUNICATION GRAPH
${commGraphSummary}

## RECURRING EMAIL CADENCES (pre-detected workflows)
${cadenceSummary}

## CALENDAR INTELLIGENCE
${calendarSummary}

## DRIVE INTELLIGENCE
${driveSummary}

## FINANCIAL EMAIL DATA
${JSON.stringify(allFinancialEmails.slice(0, 150), null, 2).slice(0, 80000)}

${adminUsers.length > 0 ? `## ADMIN DIRECTORY\n${JSON.stringify(adminUsers, null, 2).slice(0, 30000)}` : ""}

## ANALYSIS INSTRUCTIONS

Focus on what the data actually shows. Ignore passes where you lack data.

### DEFENSIBLE FINDINGS (do these when real evidence exists)

1. **REAL INVOICE AMOUNTS** — The financial emails below may contain actual invoice amounts. Extract them. "Harmonic AI charged $22,000 on Apr 5, 2026" is defensible. "This exceeds their budget" is NOT (you don't know their budget).

2. **RECURRING BILLING PATTERNS** — If you see the same vendor sending invoices monthly/quarterly, that's a subscription. Call it out with the actual amounts.

3. **TOOL DETECTION FROM EMAIL SENDERS** — The tech stack list below shows tools detected by sender domain. That's real.

4. **RENEWAL DATES MENTIONED IN EMAILS** — Only include dates that are literally in the email body. If a renewal email says "renews on June 15, 2026", that's a finding. If no date is mentioned, don't guess.

5. **DUPLICATE / COMPETING TOOLS** — Flag tools that serve the same purpose, even across categories.
   - **Evidence threshold (required):** BOTH tools must have ≥3 emails in the tech stack OR ≥1 invoice in the data below. Skip if one tool only shows 1-2 emails (likely trial/abandoned).
   - Same category examples: Slack + Teams, Asana + Monday.com, Zoom + Google Meet
   - Cross-category examples (same underlying job): Harmonic AI + PitchBook (investor/company intel), Clay + Apollo (sales prospecting), Notion + Coda (docs/workspace)
   - **Do NOT override our category data** based on general knowledge alone. If the tech stack shows two tools with meaningful email activity that you believe compete, flag them. Otherwise skip.
   - Each overlap finding: both tool names + their shared purpose + recommendation to consolidate.

6. **OBSERVABLE RECURRING PROCESSES** — The cadence data pre-detected patterns. Turn each into a workflow entry with real evidence.

7. **AUTOMATABLE WORKFLOWS** — Look for these SPECIFIC patterns and recommend concrete automations:

   **RECEIPT & EXPENSE AUTOMATION** (travel, SaaS receipts, meals)
   - Pattern: Multiple receipt emails from same vendor (Uber, Airlines, Amazon, SaaS tools) with dollar amounts
   - Automation: Extract receipts → categorize → push to QuickBooks/Expensify/Brex

   **SUBSCRIPTION / RENEWAL TRACKING**
   - Pattern: Monthly/annual renewal notifications across multiple tools
   - Automation: Central subscription tracker with 30/60/90 day alerts

   **INVOICE PROCESSING**
   - Pattern: Invoice emails with consistent format (vendor → amount → due date)
   - Automation: Extract line items → AP workflow → approval routing

   **MEETING-TO-ACTION EXTRACTION**
   - Pattern: Recurring meetings followed by summary emails
   - Automation: Meeting transcript → action items → task system (Linear/Asana)

   **STATUS REPORTING**
   - Pattern: Weekly/monthly reports sent manually, often compiled from multiple sources
   - Automation: Auto-pull metrics → generate report → distribute

   **LEAD ROUTING / QUALIFICATION**
   - Pattern: Inbound emails from prospects requiring routing
   - Automation: Classify → enrich → assign to owner → CRM entry

   **SCHEDULING BACK-AND-FORTH**
   - Pattern: 3+ emails to schedule one meeting
   - Automation: Calendly/Clara-style scheduling bot

   **APPROVAL CHAINS**
   - Pattern: Forward chain for approvals (A→B→C→B→A)
   - Automation: Formal workflow tool (Ramp approvals, ApprovalMax)

   **FAQ / TEMPLATE EMAILS**
   - Pattern: Same question being answered repeatedly
   - Automation: Knowledge base, template responses, AI email assistant

   **CROSS-SYSTEM DATA ENTRY**
   - Pattern: Spreadsheets emailed between people, "update the sheet" mentions
   - Automation: Direct integration between systems (Zapier, Make, native APIs)

   **NEWSLETTER / DIGEST**
   - Pattern: Many newsletter senders filling inbox
   - Automation: Auto-summarize → weekly digest

   **VENDOR STATUS CHECKS**
   - Pattern: Recurring meetings with same vendors, often for status updates
   - Automation: Shared status dashboard replacing sync meetings

### NOT AUTOMATABLE (don't suggest these)
- Negotiations of any kind
- Vendor relationship management
- Strategic decisions
- Approval of >$X dollars
- Anything requiring human judgment on trust, fit, or strategy

8. **WORK PATTERN INSIGHTS** — Use the after-hours / reply latency / meeting load data:
   - If afterHoursPct > 30%: User works nights. Flag as "reclaim time" opportunity via delegation/automation.
   - If weekendPct > 15%: Weekend work pattern. Worth noting.
   - If backToBack > 20% of total meetings: Calendar fragmentation, minimal deep work. Recommend meeting audit.
   - If median reply < 15 min: Interrupt-driven. Likely fighting fires instead of proactive work.
   - If median reply > 24 hr: Bottleneck on user. Consider email triage automation or delegation.
   - If one meeting type dominates (e.g., 30+ 1:1s): That's a lot of overhead. Recommend batching or async.

8b. **MEETING TIME ANALYSIS** — Use calendar data neutrally. Report observations, not judgments:
   - If meetingHoursPerWeek > 20: That's half the work week. Flag as "meeting audit" opportunity but don't say meetings are "bad" — say "worth asking which standing meetings still earn their time."
   - Look at the "Top standing meetings by total time" list. The biggest time consumers are prime candidates for questions: could this be async? shorter? less frequent? fewer attendees?
   - If focusTimePerWeekday < 2h: Deep work is being squeezed. Recommend "meeting-free mornings" or similar pattern.
   - If meetingsDeclined > accepted/2: User is already declining a lot. Don't recommend more meeting reduction — they're doing it.
   - Meetings with 8+ attendees running 60+ min recurring = strong candidate for async update.
   - Meetings with 2 attendees running 30+ min recurring (1:1s) are usually justified — don't flag these unless there are 20+ of them.
   - Frame recommendations as questions, not commands. "Is the 26h spent in weekly standup still earning its time?" not "Cancel the weekly standup."

9. **DRIVE INTELLIGENCE INSIGHTS** — Use Drive file data:
   - Shared spreadsheets with many permissions = potential "spreadsheet-as-database" (candidate for real tool)
   - Multiple contracts/SOWs with no central tracking = recommend contract management tool
   - Recent docs in last 30 days shows active workflows (what are they working on right now?)

### DO NOT DO THESE PASSES (not enough data from single inbox)
- ❌ License waste estimates (no actual usage data)
- ❌ Tier optimization recommendations (no tier data)
- ❌ "X handles Y% of communications" (only see one inbox)
- ❌ Key person risk for the organization (only one inbox)
- ❌ Information bottleneck identification (only one inbox)
- ❌ Comparing invoice to "budget" (no budget data)
- ❌ Inventing dollar savings numbers

### WHAT TO DO INSTEAD OF THE ABOVE

For things you can't determine, turn them into gaps: "We detected you use Salesforce. To tell you if you're overpaying on seats, we'd need to connect Salesforce admin API to see active users vs licensed users."

## OUTPUT FORMAT

{
  "summary": {
    "totalAnnualSpend": "sum of REAL invoice amounts from financial emails, or null if none found",
    "totalAnnualWaste": "null unless you have real evidence of specific waste — NOT a generic estimate",
    "totalAutomatableHours": "XX hours/month (from workflows with automationScore >= 70)",
    "findingsCount": N,
    "criticalCount": N,
    "appsDiscovered": ${techStack.length},
    "workflowsDiscovered": N,
    "workflowsAutomatable": N,
    "systemsCrawled": ["Gmail", "Drive", "Calendar"${isAdmin ? ', "Admin Directory"' : ""}],
    "coverageScore": 25-40 (this is a single-inbox scan, coverage is inherently limited),
    "topRiskArea": "one sentence about the strongest evidence-backed finding"
  },
  "workflows": [
    {
      "name": "Short name like 'Weekly Sales Report' or 'Invoice Approval Chain'",
      "type": "recurring_report | approval_chain | data_entry | human_middleware | manual_data_exchange | meeting_driven | cross_system",
      "description": "SPECIFIC: name real people, real email subjects, real cadences from the data",
      "frequency": "daily | weekly | biweekly | monthly | quarterly | ad-hoc",
      "participants": ["actual@emails.com from the data"],
      "evidence": "Cite the specific cadence pattern, email, or calendar event that revealed this",
      "avgCycleTime": "estimated time per cycle",
      "bottleneck": "The step or person that takes longest",
      "automationScore": 0-100,
      "agentBlueprint": {
        "trigger": "What starts this workflow",
        "steps": ["Step 1", "Step 2", "Step 3"],
        "humanInTheLoop": "Where a human stays involved",
        "integrationsNeeded": ["Tool1", "Tool2"],
        "complexity": "low | medium | high"
      },
      "estimatedTimeSavings": "X hours/week",
      "estimatedAnnualSavings": "$XXK"
    }
  ],
  "findings": [
    {
      "title": "Under 80 chars",
      "description": "2-3 sentences with SPECIFIC data from the crawl.",
      "amount": "$XXK",
      "severity": "critical | high | medium",
      "category": "Licensing | Duplicates | Pricing | Procurement | Compliance | Operations | Risk | Knowledge",
      "department": "inferred",
      "agent": "Ledger | Quartermaster | Chief | Scout | Signal | Atlas",
      "recommendation": "SPECIFIC action with numbers",
      "evidence": "data from crawl",
      "timeToValue": "immediate | 30 days | 90 days | 6 months"
    }
  ],
  "gaps": [
    {
      "priority": 1,
      "type": "connect_app | upload_data | desktop_scan | manual_input",
      "appName": "specific app from email, or null",
      "icon": "quickbooks | slack | salesforce | xero | netsuite | desktop | upload | generic",
      "title": "Short headline",
      "description": "WHAT this unlocks, personalized to their data",
      "howToProvide": "Step-by-step instructions",
      "expectedFindings": N,
      "expectedValue": "$XXK",
      "unlocks": ["specific unlock 1", "specific unlock 2"],
      "coverageBefore": N,
      "coverageAfter": N
    }
  ],
  "renewalCalendar": [
    { "vendor": "name", "renewalDate": "YYYY-MM-DD or estimate", "estimatedCost": "$XXK", "action": "Renegotiate | Cancel | Review", "urgency": "urgent | upcoming | future" }
  ],
  "automationOpportunities": [
    { "process": "description", "evidence": "what revealed it", "estimatedTimeSavings": "X hours/week", "recommendedTool": "specific tool", "complexity": "low | medium | high" }
  ]
}

RULES:
- **Quality over quantity.** 3-8 findings with real evidence beats 15 made-up ones.
- **No findings based on data you don't have.** If you need org budget, tier info, or usage stats to make a claim, turn it into a GAP instead ("Connect Salesforce to see which users are inactive").
- **Dollar amounts MUST come from the actual financial emails below.** Do not invent budgets, "savings", or spend estimates. If the data doesn't support a number, leave amount as null.
- **Every workflow MUST cite specific evidence** (real sender, real subject, real dates from the data).
- **If the data is thin, produce fewer findings.** Don't pad.
- **Automation score should reflect reality.** Negotiations, relationship management, strategic decisions = low score (under 30). Data entry, notifications, categorization = high score (70+).
- **For gaps: list concrete systems to connect** that would unlock specific findings. Be specific: "Connect QuickBooks to see actual SaaS expenses" not "provide financial data".
- **Respond ONLY with the JSON.**`;

      try {
        let message;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const opusStream = anthropic.messages.stream({
              model: "claude-opus-4-7",
              max_tokens: 16384,
              messages: [{ role: "user", content: prompt }],
            });
            message = await opusStream.finalMessage();
            break;
          } catch (err: unknown) {
            const status = (err as { status?: number }).status;
            if (status === 529 && attempt < 2) {
              send({ type: "agent-log", agent: "Atlas", message: "High demand — retrying...", logType: "progress" });
              await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
              continue;
            }
            throw err;
          }
        }

        if (!message) throw new Error("Analysis failed");

        send({ type: "progress", records: 100, scanned: 80, message: "Opus analysis complete. Streaming findings..." });

        const content = message.content[0];
        if (!content || content.type !== "text") {
          throw new Error("No text response from analysis");
        }

        let text = content.text.trim();
        // Strip code fences defensively (handles leading whitespace, different fence styles)
        text = text.replace(/^[\s]*```(?:json)?[\s]*/m, "").replace(/[\s]*```[\s]*$/m, "").trim();

        const parsed = JSON.parse(text);
        const findings = parsed.findings || [];
          const summary = parsed.summary;
          const gaps = parsed.gaps;

          if (summary) {
            send({ type: "summary", ...summary });
            send({ type: "agent-log", agent: "Dispatch", message: `Spend: ${summary.totalAnnualSpend}. Waste: ${summary.totalAnnualWaste}. ${summary.findingsCount} findings. ${summary.workflowsDiscovered || 0} workflows.`, logType: "finding" });
          }

          for (let i = 0; i < findings.length; i++) {
            await new Promise((r) => setTimeout(r, 100));
            send({ type: "agent-log", agent: findings[i].agent || "Atlas", message: `${findings[i].title}${findings[i].amount ? " — " + findings[i].amount : ""}`, logType: "finding" });
            send({ type: "finding", ...findings[i] });
            send({ type: "progress", records: 100, scanned: 80 + Math.floor((15 * (i + 1)) / findings.length), message: `Delivered ${i + 1}/${findings.length} findings...` });
          }

          if (gaps) {
            send({ type: "gaps", gaps });
          }

          const workflows = parsed.workflows;
          if (workflows && workflows.length > 0) {
            send({ type: "workflows", workflows });
            send({ type: "agent-log", agent: "Signal", message: `${workflows.length} workflows discovered. ${workflows.filter((w: { automationScore?: number }) => (w.automationScore || 0) >= 70).length} automatable.`, logType: "finding" });
          }

          const renewalCalendar = parsed.renewalCalendar;
          if (renewalCalendar && renewalCalendar.length > 0) {
            send({ type: "renewals", renewals: renewalCalendar });
          }

          const automationOpps = parsed.automationOpportunities;
          if (automationOpps && automationOpps.length > 0) {
            send({ type: "automations", automations: automationOpps });
          }

          // Persist
          if (scanId && userId) {
            try {
              for (const f of findings) {
                await saveFinding(scanId, userId, f);
              }
              await completeScan(scanId, {
                summary,
                techStack: techStackForUI,
                gaps,
                renewals: renewalCalendar,
                automations: automationOpps,
                workflows: workflows || [],
                orgIntelligence: orgIntelData,
                findingsCount: findings.length,
                totalWaste: summary?.totalAnnualWaste,
                coverageScore: summary?.coverageScore,
              });
            } catch { /* persistence is non-critical */ }
          }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // Provide user-friendly error messages for common failures
        let friendlyMsg = "Analysis failed. Please try again.";
        if (errMsg.includes("credit balance") || errMsg.includes("billing")) {
          friendlyMsg = "Our AI analysis service is temporarily unavailable. Please try again in a few minutes.";
        } else if (errMsg.includes("overloaded") || errMsg.includes("529")) {
          friendlyMsg = "High demand right now. Please try again in a minute.";
        } else if (errMsg.includes("rate_limit") || errMsg.includes("429")) {
          friendlyMsg = "Too many requests. Please wait a moment and try again.";
        } else if (errMsg.includes("context") || errMsg.includes("too long")) {
          friendlyMsg = "Your data set is very large. Try scanning a smaller time range.";
        }
        send({ type: "agent-log", agent: "Atlas", message: `Analysis error: ${errMsg.slice(0, 100)}`, logType: "progress" });
        send({ type: "error", message: friendlyMsg });
        send({ type: "progress", records: 100, scanned: 100, message: "Scan failed." });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }

      // Record scan cost (only on success)
      if (userId) {
        try {
          await recordScanCost(userId, 30);
        } catch { /* non-critical */ }
      }

      send({ type: "progress", records: 100, scanned: 100, message: "Scan complete." });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();

      } catch (fatalErr) {
        // Top-level safety net: ensure the stream always closes
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: `Unexpected error: ${fatalErr instanceof Error ? fatalErr.message : "Unknown"}` })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch { /* controller may already be closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
