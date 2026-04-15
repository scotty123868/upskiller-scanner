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
      send({ type: "progress", records: 100, scanned: 0, message: "Starting full system crawl..." });

      // ═══════════════════════════════════════
      // AGENT 1: SCOUT — Full Email Metadata Extraction
      // Now fetches To/CC/BCC/threadId on ALL recent emails
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Scout", message: "Scanning Gmail metadata: senders, recipients, threads, attachments...", logType: "discovery" });

      try {
        const gmail = google.gmail({ version: "v1", auth: oauth2Client });

        // Get recent email IDs — up to 800 for richer signal
        const senderRes = await gmail.users.messages.list({ userId: "me", maxResults: 500, q: "newer_than:6m" });
        const messageIds = senderRes.data.messages || [];
        send({ type: "agent-log", agent: "Scout", message: `Extracting metadata from ${messageIds.length} recent emails...`, logType: "discovery" });

        const senderDomains = new Map<string, number>();
        const batch = messageIds.slice(0, 500);

        for (let i = 0; i < batch.length; i++) {
          try {
            const msg = await gmail.users.messages.get({
              userId: "me",
              id: batch[i].id!,
              format: "metadata",
              metadataHeaders: ["From", "To", "Cc", "Subject", "Date", "Content-Type"],
            });
            const headers = msg.data.payload?.headers || [];
            const getHeader = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

            const from = getHeader("From");
            const to = getHeader("To");
            const cc = getHeader("Cc");
            const subject = getHeader("Subject");
            const date = getHeader("Date");
            const contentType = getHeader("Content-Type");
            const threadId = msg.data.threadId || "";

            // Parse email addresses
            const extractEmails = (header: string): string[] => {
              const matches = header.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
              return [...new Set(matches.map((e) => e.toLowerCase()))];
            };

            const fromEmail = extractEmails(from)[0] || "";
            const toEmails = extractEmails(to);
            const ccEmails = extractEmails(cc);
            const domain = fromEmail.split("@")[1]?.replace(/^(noreply\.|no-reply\.|notifications\.|info\.|support\.|billing\.|team\.|hello\.)/, "").replace(/^www\./, "") || "";

            // Detect forwards and replies
            const isForward = subject.toLowerCase().startsWith("fwd:") || subject.toLowerCase().startsWith("fw:");
            const isReply = subject.toLowerCase().startsWith("re:");
            const hasAttachment = contentType.includes("mixed") || contentType.includes("attachment");

            allEmailMeta.push({
              from: fromEmail,
              to: toEmails,
              cc: ccEmails,
              subject,
              date,
              threadId,
              hasAttachment,
              isForward,
              isReply,
              domain,
            });

            // Track sender domains for SaaS discovery
            if (domain) {
              senderDomains.set(domain, (senderDomains.get(domain) || 0) + 1);
            }
          } catch { /* skip */ }

          if (i > 0 && i % 100 === 0) {
            send({ type: "progress", records: 100, scanned: Math.floor((i / batch.length) * 15), message: `Extracted metadata from ${i}/${batch.length} emails...` });
          }
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

        for (const search of searches) {
          try {
            const res = await gmail.users.messages.list({ userId: "me", q: search.q, maxResults: 100 });
            const messages = res.data.messages || [];
            if (messages.length === 0) continue;

            send({ type: "agent-log", agent: "Ledger", message: `Found ${messages.length} ${search.label} emails`, logType: "discovery" });
            totalItems += messages.length;

            const toRead = messages.slice(0, 40);
            for (let i = 0; i < toRead.length; i++) {
              try {
                const msg = await gmail.users.messages.get({ userId: "me", id: toRead[i].id!, format: "full" });
                const headers = msg.data.payload?.headers || [];
                const from = headers.find((h) => h.name === "From")?.value || "";
                const subject = headers.find((h) => h.name === "Subject")?.value || "";
                const date = headers.find((h) => h.name === "Date")?.value || "";

                // Extract body text
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

                // Context-aware amount extraction: prefer amounts near cost keywords
                const amounts = body.match(/\$[\d,]+(?:\.\d{2})?/g) || [];
                const uniqueAmounts = [...new Set(amounts)];

                // Track amounts per app
                const domain = from.match(/@([^>]+)/)?.[1]?.toLowerCase().replace(/^www\./, "") || "";
                if (domain) {
                  const app = lookupDomain(domain);
                  if (app && discoveredApps.has(app.name)) {
                    const entry = discoveredApps.get(app.name)!;
                    uniqueAmounts.forEach((a) => {
                      const num = parseFloat(a.replace(/[$,]/g, ""));
                      if (!isNaN(num) && num > 0 && num < 1000000) entry.amounts.push(num);
                    });
                  }
                }

                allFinancialEmails.push({
                  from, subject, date,
                  body: body.slice(0, 2000),
                  category: search.label,
                  amounts: uniqueAmounts,
                  domain,
                });
              } catch { /* skip */ }
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
          { q: "name contains 'contract' or name contains 'agreement' or name contains 'SOW'", cat: "contracts" },
          { q: "name contains 'invoice' or name contains 'PO' or name contains 'purchase'", cat: "procurement" },
          { q: "name contains 'budget' or name contains 'vendor' or name contains 'renewal'", cat: "finance" },
          { q: "mimeType='application/vnd.google-apps.spreadsheet'", cat: "spreadsheet" },
          { q: "mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'", cat: "spreadsheet" },
        ];

        for (const search of driveSearches) {
          try {
            const res = await drive.files.list({
              q: search.q,
              pageSize: 50,
              fields: "files(name,mimeType,modifiedTime,owners,shared,permissions)",
            });
            const files = res.data.files || [];
            totalItems += files.length;
            for (const f of files) {
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

        // Deduplicate by name
        const seen = new Set<string>();
        const dedupedFiles: DriveFile[] = [];
        for (const f of allDriveFiles) {
          if (!seen.has(f.name)) {
            seen.add(f.name);
            dedupedFiles.push(f);
          }
        }
        allDriveFiles.length = 0;
        allDriveFiles.push(...dedupedFiles);

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
        const calRes = await calendar.events.list({
          calendarId: "primary",
          timeMin: sixMonthsAgo.toISOString(),
          timeMax: new Date().toISOString(),
          maxResults: 500, singleEvents: true, orderBy: "startTime",
        });
        const events = calRes.data.items || [];
        totalItems += events.length;

        for (const e of events) {
          const start = e.start?.dateTime ? new Date(e.start.dateTime) : null;
          const end = e.end?.dateTime ? new Date(e.end.dateTime) : null;
          const duration = start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : 0;

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

          allCalendarEvents.push({
            summary: e.summary || "(no title)",
            date: e.start?.dateTime || e.start?.date || "",
            duration,
            attendeeCount: e.attendees?.length || 0,
            externalDomains: [...attendeeDomains],
            isRecurring,
            conferenceType,
            organizer: e.organizer?.email || "",
          });
        }

        // Calendar stats
        const recurring = allCalendarEvents.filter((e) => e.isRecurring);
        const withExternal = allCalendarEvents.filter((e) => e.externalDomains.length > 0);
        const totalMeetingHours = Math.round(allCalendarEvents.reduce((s, e) => s + e.duration, 0) / 60);
        const confTools = new Set(allCalendarEvents.map((e) => e.conferenceType).filter(Boolean));

        send({ type: "agent-log", agent: "Signal", message: `${events.length} events analyzed. ${recurring.length} recurring. ${withExternal.length} with external attendees. ${totalMeetingHours}h total meeting time. Video tools: ${[...confTools].join(", ") || "none detected"}`, logType: "discovery" });

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
      // CADENCE & WORKFLOW PATTERN DETECTION
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Signal", message: "Detecting recurring email cadences and workflow patterns...", logType: "analysis" });

      const cadencePatterns: CadencePattern[] = [];

      // Group emails by sender + normalized subject
      const normalizeSubject = (s: string) => s.replace(/^(re:|fw:|fwd:)\s*/gi, "").replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, "DATE").replace(/\d{4}-\d{2}-\d{2}/g, "DATE").replace(/#\d+/g, "#N").replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/gi, "MONTH").replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/gi, "DAY").replace(/week\s*\d+/gi, "WEEK_N").trim();

      const senderSubjectGroups = new Map<string, { dates: Date[]; subjects: string[]; recipients: Set<string> }>();

      for (const email of allEmailMeta) {
        if (!email.from || !email.subject) continue;
        const key = `${email.from}::${normalizeSubject(email.subject)}`;
        if (!senderSubjectGroups.has(key)) {
          senderSubjectGroups.set(key, { dates: [], subjects: [], recipients: new Set() });
        }
        const group = senderSubjectGroups.get(key)!;
        const d = new Date(email.date);
        if (!isNaN(d.getTime())) group.dates.push(d);
        if (group.subjects.length < 5) group.subjects.push(email.subject);
        for (const r of email.to) group.recipients.add(r);
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
        const cost = estimateAnnualCost(data.app, orgUserCount);
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

      // Top recurring cadences for display
      const topCadences = cadencePatterns.slice(0, 8).map((p) => ({
        sender: p.sender,
        pattern: p.exampleSubjects[0] || p.subjectPattern,
        frequency: p.frequency,
        dayOfWeek: p.dayOfWeek,
        recipients: p.recipientCount,
        occurrences: p.count,
      }));

      send({
        type: "orgIntelligence",
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
      });

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
          `\nTop external domains in calendar (vendor relationships):`,
          ...topVendorMeetings.map(([d, c]) => `  - ${d}: ${c} meetings`),
          `\nRecurring meetings with external attendees:`,
          ...withExternal.filter((e) => e.isRecurring).slice(0, 10).map((e) => `  - "${e.summary}" with ${e.externalDomains.join(", ")} (${e.attendeeCount} attendees, ${e.duration}min)`),
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

      const prompt = `You are UpSkiller AI's Atlas agent. You have completed a full agentic crawl of an organization's Google Workspace and built a structured intelligence model. Your job is to produce findings that are IMMEDIATELY useful to a small business owner.

## ORGANIZATION PROFILE
- Domain: ${userDomain || "unknown"}
- Estimated org size: ${orgUserCount} users
- SaaS tools discovered: ${techStack.length}
- Estimated annual SaaS spend: ${formatCost(totalEstimatedSpendMid)}
- Items crawled: ${totalItems} (emails, files, events)
- Data sources: Gmail (metadata + financial bodies), Drive (metadata + sharing), Calendar (events + attendees)${isAdmin ? ", Admin Directory" : ""}

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

You have structured intelligence from multiple data sources. Use ALL of it. Run these analysis passes:

### SPEND INTELLIGENCE (passes 1-7)
1. LICENSE WASTE: For per-seat tools, compare email activity to org size. Low email count relative to org = possible inactive seats.
2. DUPLICATE TOOLS: Find tools in the same category (e.g., two project management tools). Recommend consolidation.
3. TIER OPTIMIZATION: If invoice amounts seem high relative to org size, flag potential for downgrade.
4. VENDOR CONSOLIDATION: Multiple tools from same category that one vendor could replace.
5. RENEWAL INTELLIGENCE: Emails mentioning renewals, expirations, auto-renewal. Build renewal calendar.
6. ACTUAL vs ESTIMATED: Compare invoice amounts to estimated pricing. Flag discrepancies.
7. SPEND BY CATEGORY: Break down annual spend by category.

### WORKFLOW DISCOVERY (passes 8-13) — THIS IS CRITICAL
Use the pre-detected cadence patterns, communication graph, attachment data, and calendar intelligence.

8. RECURRING REPORTS/PROCESSES: The cadence data shows emails sent on regular schedules. For each meaningful cadence: who sends it, what it is, how often, who receives it, and what it reveals about a manual process. BE SPECIFIC with real email addresses and subjects from the data.

9. HUMAN MIDDLEWARE: The forward ratio data identifies people who mostly relay information. These roles can be partially automated. Name the specific people and their patterns.

10. MANUAL DATA EXCHANGE: Shared spreadsheets in Drive + attachment-heavy email threads = people manually moving data between systems. Cross-reference Drive shared spreadsheets with email attachment patterns.

11. MEETING-DRIVEN WORKFLOWS: Calendar recurring meetings with specific external domains often indicate vendor check-ins, status updates, or review cycles that follow a pattern. Cross-reference calendar vendor domains with email cadences.

12. CROSS-SYSTEM PROCESSES: Financial emails mentioning multiple tools ("update the spreadsheet", "check QuickBooks", "log in Salesforce") reveal manual multi-system workflows.

13. AUTOMATION SCOPING: For each discovered workflow, design an AI agent blueprint:
- Trigger (incoming email, calendar event, time-based, data change)
- Steps the agent would perform
- Systems it would integrate
- Where a human stays in the loop
- Time savings per instance and annually
- Implementation complexity

### RISK & KNOWLEDGE (passes 14-16)
14. KEY PERSON RISK: From communication graph, identify people who are sole contacts for vendor relationships or bridge between groups.
15. SHADOW IT: Apps sending billing emails that appear to be individual purchases.
16. INFORMATION BOTTLENECKS: From the communication graph, identify people through whom most information flows. If they're out sick, what breaks?

## OUTPUT FORMAT

{
  "summary": {
    "totalAnnualSpend": "${formatCost(totalEstimatedSpendMid)}",
    "totalAnnualWaste": "$X.XK or $X.XM",
    "totalAutomatableHours": "XX hours/month",
    "findingsCount": N,
    "criticalCount": N,
    "appsDiscovered": ${techStack.length},
    "workflowsDiscovered": N,
    "workflowsAutomatable": N,
    "systemsCrawled": ["Gmail", "Drive", "Calendar"${isAdmin ? ', "Admin Directory"' : ""}],
    "coverageScore": N,
    "topRiskArea": "one sentence",
    "spendByCategory": { "category": "$XXK", ... }
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
- Find 15-25 findings and 5-15 workflows. Be exhaustive.
- Every workflow MUST cite specific evidence from the data (email addresses, subjects, cadence patterns, calendar events).
- If the cadence data shows recurring patterns, those ARE workflows. Don't ignore them.
- Gaps must be PERSONALIZED to apps found in their email.
- Respond ONLY with the JSON.`;

      try {
        let message;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const opusStream = anthropic.messages.stream({
              model: "claude-opus-4-20250514",
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
            await new Promise((r) => setTimeout(r, 300 + Math.random() * 200));
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
                techStack: techStack.slice(0, 50),
                gaps,
                renewals: renewalCalendar,
                automations: automationOpps,
                findingsCount: findings.length,
                totalWaste: summary?.totalAnnualWaste,
                coverageScore: summary?.coverageScore,
              });
            } catch { /* persistence is non-critical */ }
          }
      } catch (err) {
        send({ type: "agent-log", agent: "Atlas", message: `Analysis error: ${err instanceof Error ? err.message : "unknown"}`, logType: "progress" });
        send({ type: "error", message: `Analysis failed: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.` });
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
