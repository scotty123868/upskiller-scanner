import { google } from "googleapis";
import Anthropic from "@anthropic-ai/sdk";
import { SAAS_DATABASE, lookupDomain, estimateAnnualCost, formatCost, TOTAL_APPS } from "@/data/saas-pricing";

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

      // ═══════════════════════════════════════
      // Collected data across all agents
      // ═══════════════════════════════════════
      const discoveredApps = new Map<string, { app: typeof SAAS_DATABASE[0]; emailCount: number; categories: Set<string>; amounts: number[] }>();
      const allFinancialData: string[] = [];
      let orgUserCount = 0;
      let totalItems = 0;

      send({ type: "agent-log", agent: "Dispatch", message: `Agentic crawler initialized. ${TOTAL_APPS} apps in pricing database. Deploying 5 agents...`, logType: "progress" });
      send({ type: "progress", records: 100, scanned: 0, message: "Starting full system crawl..." });

      // ═══════════════════════════════════════
      // AGENT 1: SCOUT — SaaS Discovery from Gmail Senders
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Scout", message: "Scanning ALL Gmail sender domains to discover your tech stack...", logType: "discovery" });

      try {
        const gmail = google.gmail({ version: "v1", auth: oauth2Client });

        // Get ALL unique sender domains from recent email
        const senderRes = await gmail.users.messages.list({ userId: "me", maxResults: 500, q: "newer_than:6m" });
        const messageIds = senderRes.data.messages || [];
        send({ type: "agent-log", agent: "Scout", message: `Scanning ${messageIds.length} recent emails for SaaS sender domains...`, logType: "discovery" });

        const senderDomains = new Map<string, number>();
        const batch = messageIds.slice(0, 300);

        for (let i = 0; i < batch.length; i++) {
          try {
            const msg = await gmail.users.messages.get({ userId: "me", id: batch[i].id!, format: "metadata", metadataHeaders: ["From"] });
            const from = msg.data.payload?.headers?.find((h) => h.name === "From")?.value || "";
            const domain = from.match(/@([^>]+)/)?.[1]?.toLowerCase().replace(/^(noreply\.|no-reply\.|notifications\.|info\.|support\.|billing\.|team\.|hello\.)/, "").replace(/^www\./, "");
            if (domain) {
              senderDomains.set(domain, (senderDomains.get(domain) || 0) + 1);
            }
          } catch { /* skip */ }

          if (i > 0 && i % 50 === 0) {
            send({ type: "progress", records: 100, scanned: Math.floor((i / batch.length) * 15), message: `Scanned ${i}/${batch.length} emails for app domains...` });
          }
        }

        // Match sender domains against pricing database
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

        totalItems += senderDomains.size;
        send({ type: "agent-log", agent: "Scout", message: `Discovered ${discoveredApps.size} SaaS tools from ${senderDomains.size} unique sender domains`, logType: "discovery" });

        // List what was found
        const appList = [...discoveredApps.entries()].sort((a, b) => b[1].emailCount - a[1].emailCount);
        const topApps = appList.slice(0, 15).map(([name, d]) => `${name} (${d.emailCount} emails)`).join(", ");
        send({ type: "agent-log", agent: "Scout", message: `Top apps by email volume: ${topApps}`, logType: "discovery" });

      } catch (err) {
        send({ type: "agent-log", agent: "Scout", message: `Gmail discovery: ${err instanceof Error ? err.message.slice(0, 60) : "access denied"}`, logType: "progress" });
      }

      send({ type: "progress", records: 100, scanned: 15, message: `Discovered ${discoveredApps.size} SaaS tools. Deep scanning financial emails...` });

      // ═══════════════════════════════════════
      // AGENT 2: LEDGER — Deep Financial Email Scan (full body)
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Ledger", message: "Deep scanning financial emails — reading full body for amounts, invoices, renewals...", logType: "analysis" });

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

        const allEmails: { from: string; subject: string; date: string; body: string; category: string; amounts: string[] }[] = [];

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
                // Read FULL email body for amount extraction
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

                // Extract dollar amounts from body
                const amounts = body.match(/\$[\d,]+(?:\.\d{2})?/g) || [];
                const uniqueAmounts = [...new Set(amounts)];

                // Track amounts per app
                const domain = from.match(/@([^>]+)/)?.[1]?.toLowerCase().replace(/^www\./, "");
                if (domain) {
                  const app = lookupDomain(domain);
                  if (app && discoveredApps.has(app.name)) {
                    const entry = discoveredApps.get(app.name)!;
                    uniqueAmounts.forEach((a) => {
                      const num = parseFloat(a.replace(/[$,]/g, ""));
                      if (!isNaN(num) && num > 0) entry.amounts.push(num);
                    });
                  }
                }

                allEmails.push({
                  from, subject, date,
                  body: body.slice(0, 2000),
                  category: search.label,
                  amounts: uniqueAmounts,
                });
              } catch { /* skip */ }
            }
          } catch { /* search may fail */ }
        }

        send({ type: "agent-log", agent: "Ledger", message: `Processed ${allEmails.length} financial emails. Extracted ${allEmails.reduce((s, e) => s + e.amounts.length, 0)} dollar amounts.`, logType: "discovery" });

        // Build financial data summary for Opus
        allFinancialData.push("FINANCIAL EMAILS:\n" + JSON.stringify(allEmails.slice(0, 200), null, 2).slice(0, 100000));

      } catch (err) {
        send({ type: "agent-log", agent: "Ledger", message: `Gmail financial scan: ${err instanceof Error ? err.message.slice(0, 60) : "denied"}`, logType: "progress" });
      }

      send({ type: "progress", records: 100, scanned: 40, message: `${totalItems} items scanned. Analyzing tech stack costs...` });

      // ═══════════════════════════════════════
      // AGENT 3: QUARTERMASTER — Drive + Cost Intelligence
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Quartermaster", message: "Scanning Drive for contracts and building cost model...", logType: "analysis" });

      try {
        const drive = google.drive({ version: "v3", auth: oauth2Client });
        const driveSearches = [
          "name contains 'contract' or name contains 'agreement' or name contains 'SOW'",
          "name contains 'invoice' or name contains 'PO' or name contains 'purchase'",
          "name contains 'budget' or name contains 'vendor' or name contains 'renewal'",
        ];

        const allDocs: { name: string; modified: string; owner: string; category: string }[] = [];
        for (const q of driveSearches) {
          try {
            const res = await drive.files.list({ q, pageSize: 50, fields: "files(name,modifiedTime,owners)" });
            const files = res.data.files || [];
            totalItems += files.length;
            files.forEach((f) => allDocs.push({
              name: f.name || "", modified: f.modifiedTime || "",
              owner: f.owners?.[0]?.emailAddress || "", category: "document",
            }));
          } catch { /* skip */ }
        }

        send({ type: "agent-log", agent: "Quartermaster", message: `Found ${allDocs.length} contracts/procurement documents in Drive`, logType: "discovery" });
        allFinancialData.push("DRIVE DOCUMENTS:\n" + JSON.stringify(allDocs.slice(0, 100), null, 2).slice(0, 20000));

      } catch (err) {
        send({ type: "agent-log", agent: "Quartermaster", message: `Drive scan: ${err instanceof Error ? err.message.slice(0, 60) : "denied"}`, logType: "progress" });
      }

      // ═══════════════════════════════════════
      // AGENT 4: SIGNAL — Calendar Analysis
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Signal", message: "Analyzing calendar for vendor meetings and operational patterns...", logType: "analysis" });

      try {
        const calendar = google.calendar({ version: "v3", auth: oauth2Client });
        const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
        const calRes = await calendar.events.list({
          calendarId: "primary",
          timeMin: sixMonthsAgo.toISOString(),
          timeMax: new Date().toISOString(),
          maxResults: 250, singleEvents: true, orderBy: "startTime",
        });
        const events = calRes.data.items || [];
        totalItems += events.length;

        const vendorMeetings = events.filter((e) => {
          const s = (e.summary || "").toLowerCase();
          return s.includes("vendor") || s.includes("review") || s.includes("renewal") || s.includes("demo") || s.includes("contract");
        });

        send({ type: "agent-log", agent: "Signal", message: `${events.length} calendar events, ${vendorMeetings.length} vendor-related meetings`, logType: "discovery" });
        allFinancialData.push("VENDOR MEETINGS:\n" + JSON.stringify(vendorMeetings.slice(0, 30).map((e) => ({
          summary: e.summary, date: e.start?.dateTime || e.start?.date, attendees: e.attendees?.length || 0,
        })), null, 2).slice(0, 10000));

      } catch (err) {
        send({ type: "agent-log", agent: "Signal", message: `Calendar: ${err instanceof Error ? err.message.slice(0, 60) : "denied"}`, logType: "progress" });
      }

      // ═══════════════════════════════════════
      // ADMIN-ONLY: User count for cost estimation
      // ═══════════════════════════════════════
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
          send({ type: "agent-log", agent: "Scout", message: `${inactive.length} users inactive 90+ days (still consuming licenses)`, logType: "discovery" });

          allFinancialData.push("USERS:\n" + JSON.stringify(users.map((u) => ({
            email: u.primaryEmail, name: u.name?.fullName, lastLogin: u.lastLoginTime,
            suspended: u.suspended, isAdmin: u.isAdmin, orgUnit: u.orgUnitPath,
          })), null, 2).slice(0, 30000));
        } catch {
          send({ type: "agent-log", agent: "Scout", message: "Admin Directory not accessible. Using email-based user estimation.", logType: "progress" });
        }
      }

      // If no admin access, estimate user count from email patterns
      if (orgUserCount === 0) orgUserCount = 50; // Conservative default

      send({ type: "progress", records: 100, scanned: 55, message: `Full crawl complete. ${totalItems} items. Building cost model...` });

      // ═══════════════════════════════════════
      // COST INTELLIGENCE: Build tech stack cost model
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Atlas", message: "Building cost intelligence model from discovered apps...", logType: "analysis" });

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

      send({ type: "agent-log", agent: "Atlas", message: `Tech stack: ${techStack.length} tools. Estimated total annual spend: ${formatCost(totalEstimatedSpendMid)}`, logType: "finding" });

      // Send tech stack as a special event for the UI
      send({
        type: "techStack",
        apps: techStack.slice(0, 50).map((t) => ({
          name: t.name,
          category: t.category,
          estimatedCost: t.estimatedAnnualCost ? formatCost(t.estimatedAnnualCost.mid) + "/yr" : "usage-based",
          emailActivity: t.emailCount,
          actualAmounts: t.actualAmounts.slice(0, 5),
        })),
        totalEstimatedSpend: formatCost(totalEstimatedSpendMid),
        appCount: techStack.length,
        userCount: orgUserCount,
      });

      send({ type: "progress", records: 100, scanned: 65, message: `Cost model built: ${formatCost(totalEstimatedSpendMid)}/yr across ${techStack.length} tools. Running Opus analysis...` });

      // ═══════════════════════════════════════
      // AGENT 5: ATLAS — Opus 4.6 Deep Analysis
      // ═══════════════════════════════════════
      send({ type: "agent-log", agent: "Atlas", message: "Running Opus 4.6 deep analysis with pricing intelligence...", logType: "analysis" });

      const techStackSummary = techStack.map((t) => {
        const cost = t.estimatedAnnualCost;
        const costStr = cost ? `${formatCost(cost.low)}-${formatCost(cost.high)}/yr (mid: ${formatCost(cost.mid)})` : "usage-based";
        const actualStr = t.actualAmounts.length > 0 ? `. Actual amounts found in emails: ${t.actualAmounts.map((a) => "$" + a.toFixed(2)).join(", ")}` : "";
        return `- ${t.name} (${t.category}): ${t.pricingModel} pricing, est. ${costStr}, ${t.emailCount} emails${actualStr}`;
      }).join("\n");

      const prompt = `You are UpSkiller AI's Atlas agent. You have completed a full agentic crawl of an organization and built a cost intelligence model.

## ORGANIZATION PROFILE
- Estimated users: ${orgUserCount}
- SaaS tools discovered: ${techStack.length}
- Estimated total annual SaaS spend: ${formatCost(totalEstimatedSpendMid)}
- Financial emails analyzed: ${allFinancialData.length} data sources
- Items crawled: ${totalItems}

## DISCOVERED TECH STACK WITH PRICING
${techStackSummary}

## RAW FINANCIAL DATA
${allFinancialData.join("\n\n").slice(0, 400000)}

## ANALYSIS INSTRUCTIONS

You have the complete tech stack with pricing AND real financial email data. Run a 7-pass analysis:

1. LICENSE WASTE: For each per-seat tool, estimate inactive seats. If org has ${orgUserCount} users but a tool only has ${Math.floor(orgUserCount * 0.3)} emails of activity, flag the gap. Calculate savings from reducing seats.

2. DUPLICATE TOOLS: Find tools serving the same function (e.g., Asana AND Monday, Slack AND Teams). Recommend consolidation with dollar impact.

3. TIER OPTIMIZATION: For tools with tiered pricing, check if actual usage (email volume, amounts) suggests they're overpaying for a higher tier.

4. VENDOR CONSOLIDATION: Multiple tools from same category. Could one vendor replace several?

5. RENEWAL INTELLIGENCE: Any renewal/subscription emails approaching dates? Flag for renegotiation.

6. ACTUAL vs ESTIMATED: Where email amounts were found, compare to estimated pricing. Flag discrepancies.

7. TOTAL SPEND PICTURE: Paint the complete annual SaaS spend picture. Break down by category.

## OUTPUT FORMAT

{
  "summary": {
    "totalAnnualSpend": "${formatCost(totalEstimatedSpendMid)}",
    "totalAnnualWaste": "$X.XM",
    "findingsCount": N,
    "criticalCount": N,
    "appsDiscovered": ${techStack.length},
    "systemsCrawled": ["Gmail", "Drive", "Calendar"${isAdmin ? ', "Admin Directory"' : ""}],
    "coverageScore": N,
    "topRiskArea": "one sentence",
    "spendByCategory": { "CRM": "$XXK", "Communication": "$XXK", ... }
  },
  "findings": [
    {
      "title": "Under 80 chars",
      "description": "2-3 sentences. Reference ACTUAL app names, pricing, user counts, email amounts.",
      "amount": "$XXK",
      "severity": "critical | high | medium",
      "category": "Licensing | Duplicates | Pricing | Procurement | Compliance | Operations | Risk | Knowledge",
      "department": "inferred",
      "agent": "Ledger | Quartermaster | Chief | Scout | Signal | Atlas",
      "recommendation": "SPECIFIC: 'Cancel 12 inactive Salesforce seats at $165/mo each = $23.7K/yr savings'",
      "evidence": "data from crawl",
      "timeToValue": "immediate | 30 days | 90 days | 6 months"
    }
  ],
  "gaps": [
    {
      "section": "Command Center section",
      "status": "populated | partial | empty",
      "coverage": N,
      "dataNeeded": "What to provide",
      "howToProvide": "Step-by-step: 'In QuickBooks: Reports > Expenses by Vendor > Export CSV'",
      "expectedValue": "Estimated additional waste"
    }
  ]
}

Find 15-25 findings. Every finding must reference specific apps, pricing, and user counts from the tech stack above. The gaps section tells the user exactly what to upload next.

Respond ONLY with the JSON.`;

      try {
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
        if (content.type === "text") {
          let text = content.text.trim();
          if (text.startsWith("```")) text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

          const parsed = JSON.parse(text);
          const findings = parsed.findings || [];
          const summary = parsed.summary;
          const gaps = parsed.gaps;

          if (summary) {
            send({ type: "summary", ...summary });
            send({ type: "agent-log", agent: "Dispatch", message: `Total spend: ${summary.totalAnnualSpend}. Waste identified: ${summary.totalAnnualWaste}. ${summary.findingsCount} findings across ${summary.appsDiscovered} apps.`, logType: "finding" });
          }

          for (let i = 0; i < findings.length; i++) {
            await new Promise((r) => setTimeout(r, 400 + Math.random() * 200));
            send({ type: "agent-log", agent: findings[i].agent || "Atlas", message: `${findings[i].title}${findings[i].amount ? " — " + findings[i].amount : ""}`, logType: "finding" });
            send({ type: "finding", ...findings[i] });
            send({ type: "progress", records: 100, scanned: 80 + Math.floor((15 * (i + 1)) / findings.length), message: `Delivered ${i + 1}/${findings.length} findings...` });
          }

          if (gaps) {
            send({ type: "gaps", gaps });
            send({ type: "agent-log", agent: "Atlas", message: `Gap analysis: ${gaps.filter((g: { status: string }) => g.status === "empty").length} sections need more data. Coverage: ${summary?.coverageScore || 0}%`, logType: "analysis" });
          }
        }
      } catch (err) {
        send({ type: "agent-log", agent: "Atlas", message: `Analysis error: ${err instanceof Error ? err.message : "unknown"}`, logType: "progress" });
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
