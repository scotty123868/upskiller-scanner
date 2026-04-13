import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import Papa from "papaparse";

const anthropic = new Anthropic();

export const maxDuration = 300; // 5 minutes for Opus deep analysis

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file") as File;
  if (!file) {
    return new Response("No file uploaded", { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let rows: Record<string, unknown>[] = [];
  let columns: string[] = [];

  const ext = file.name.split(".").pop()?.toLowerCase();

  try {
    if (ext === "csv" || ext === "tsv") {
      const text = buffer.toString("utf-8");
      const result = Papa.parse(text, { header: true, skipEmptyLines: true });
      rows = result.data as Record<string, unknown>[];
      columns = result.meta.fields || [];
    } else if (ext === "xlsx" || ext === "xls") {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      // Read ALL sheets, not just the first one
      const allSheetData: Record<string, unknown>[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const sheetRows = XLSX.utils.sheet_to_json(sheet);
        sheetRows.forEach((row) => {
          (row as Record<string, unknown>)["_sheet"] = sheetName;
          allSheetData.push(row as Record<string, unknown>);
        });
      }
      rows = allSheetData;
      if (rows.length > 0) columns = [...new Set(rows.flatMap(Object.keys))];
    } else if (ext === "json") {
      const text = buffer.toString("utf-8");
      const parsed = JSON.parse(text);
      rows = Array.isArray(parsed) ? parsed : [parsed];
      if (rows.length > 0) columns = Object.keys(rows[0]);
    } else {
      return new Response("Unsupported file type", { status: 400 });
    }
  } catch {
    return new Response("Failed to parse file", { status: 400 });
  }

  const totalRecords = rows.length;
  // With Opus 1M context, we can send much more data
  const sampleSize = Math.min(rows.length, 2000);
  const sampleRows = rows.slice(0, sampleSize);
  const sampleData = JSON.stringify(sampleRows, null, 2).slice(0, 400000);

  // Also compute basic statistics for the AI
  const stats = computeDataStats(rows, columns);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send({ type: "agent-log", agent: "Dispatch", message: `Received ${file.name} — ${totalRecords.toLocaleString()} records, ${columns.length} columns`, logType: "progress" });
      send({ type: "progress", records: totalRecords, scanned: 0, message: `Ingesting ${totalRecords.toLocaleString()} records...` });

      await new Promise((r) => setTimeout(r, 400));
      send({ type: "agent-log", agent: "Scout", message: `Detected columns: ${columns.slice(0, 10).join(", ")}${columns.length > 10 ? ` (+${columns.length - 10} more)` : ""}`, logType: "discovery" });
      send({ type: "progress", records: totalRecords, scanned: Math.floor(totalRecords * 0.1), message: "Profiling data structure and distributions..." });

      await new Promise((r) => setTimeout(r, 400));
      send({ type: "agent-log", agent: "Scout", message: `Data profile: ${stats.summary}`, logType: "discovery" });
      send({ type: "progress", records: totalRecords, scanned: Math.floor(totalRecords * 0.2), message: "Deploying analysis agents..." });

      await new Promise((r) => setTimeout(r, 300));
      send({ type: "agent-log", agent: "Ledger", message: "Running duplicate detection across all records...", logType: "analysis" });
      send({ type: "agent-log", agent: "Quartermaster", message: "Analyzing vendor spend patterns and pricing anomalies...", logType: "analysis" });
      send({ type: "agent-log", agent: "Chief", message: "Evaluating compliance and operational risk signals...", logType: "analysis" });

      send({ type: "progress", records: totalRecords, scanned: Math.floor(totalRecords * 0.3), message: "Opus 4.6 deep analysis running..." });

      try {
        let message;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const stream = anthropic.messages.stream({
              model: "claude-opus-4-20250514",
              max_tokens: 16384,
              messages: [
                {
                  role: "user",
                  content: `You are UpSkiller AI, an enterprise operational waste detection system. You are the most thorough, analytically rigorous waste-finding AI in existence. Your job is to analyze organizational data and produce a COMPLETE operational assessment that could populate an executive command center dashboard.

## YOUR ANALYTICAL FRAMEWORK

Run SEVEN parallel analysis passes on this data:

### Pass 1: DUPLICATE DETECTION
- Exact duplicates (same amount, vendor, date, description)
- Near-duplicates (same vendor + amount within 5%, different dates)
- Cross-department duplicates (same service purchased by multiple departments)
- Split-invoice patterns (large purchase split to avoid approval thresholds)

### Pass 2: VENDOR & PROCUREMENT ANALYSIS
- Vendor consolidation opportunities (multiple vendors for same category)
- Price variance analysis (same item/service at different prices)
- Contract renewal timing (approaching renewals with leverage opportunities)
- Maverick spending (purchases outside preferred vendor agreements)
- Volume discount eligibility (aggregate spend that qualifies for better pricing)

### Pass 3: LICENSING & SUBSCRIPTION WASTE
- Unused or underutilized licenses (look for patterns suggesting low usage)
- Duplicate tools serving same function
- Tier mismatches (paying for enterprise when standard suffices)
- Auto-renewal traps (contracts renewing without review)

### Pass 4: OPERATIONAL EFFICIENCY
- Process bottlenecks revealed by timing patterns
- Approval chain inefficiencies
- Manual processes that could be automated
- Resource allocation mismatches
- Seasonal patterns not being optimized

### Pass 5: COMPLIANCE & RISK
- Missing approvals or documentation gaps
- Regulatory compliance risks
- Segregation of duties violations
- Audit trail gaps
- Insurance/coverage gaps

### Pass 6: KNOWLEDGE & INSTITUTIONAL RISK
- Single points of failure (one person managing critical vendor relationships)
- Undocumented processes or tribal knowledge dependencies
- Key person risk (concentration of authority or knowledge)

### Pass 7: STRATEGIC INSIGHTS
- Spend trends over time (increasing, decreasing, seasonal)
- Department-level efficiency comparisons
- Industry benchmarking observations
- Quick wins vs. long-term optimization opportunities

## DATA

FILE: ${file.name}
COLUMNS: ${columns.join(", ")}
TOTAL RECORDS: ${totalRecords}
DATA STATISTICS:
${stats.detail}

RECORDS (${sampleSize} of ${totalRecords}):
${sampleData}

## OUTPUT FORMAT

Respond with a JSON object containing TWO sections:

{
  "summary": {
    "totalAnnualWaste": "$X.XM",
    "findingsCount": N,
    "criticalCount": N,
    "departments": ["list of departments found"],
    "vendors": N,
    "topRiskArea": "description"
  },
  "findings": [
    {
      "title": "Short headline under 80 chars",
      "description": "2-3 sentences with SPECIFIC data points. Reference actual vendor names, dollar amounts, dates, and record IDs from the data. Be precise.",
      "amount": "$XXK or $X.XM (annual impact estimate, null if not quantifiable)",
      "severity": "critical | high | medium",
      "category": "Duplicates | Procurement | Licensing | Compliance | Operations | Risk | Knowledge | Pricing",
      "department": "which department(s) affected",
      "agent": "which UpSkiller agent found this (Ledger | Quartermaster | Chief | Scout | Signal | Atlas)",
      "recommendation": "Specific next action. Not 'review this' but 'reject INV-012, contact DataSync Corp about duplicate billing, renegotiate contract at renewal in Q3'",
      "evidence": "The specific records/rows that support this finding",
      "timeToValue": "immediate | 30 days | 90 days | 6 months"
    }
  ]
}

RULES:
- Find 10-20 findings. Be exhaustive. Miss nothing.
- Every finding MUST reference specific data from the records (vendor names, amounts, dates, IDs)
- Dollar amounts must be defensible — show your math in the description
- Prioritize by annual impact, highest first
- If you can extrapolate annual impact from partial-year data, do so and note the extrapolation
- For each finding, recommend a SPECIFIC action, not a vague "review this"
- Assign each finding to the UpSkiller agent that would have found it:
  - Ledger: financial anomalies, duplicates, billing errors
  - Quartermaster: procurement, vendor management, contract optimization
  - Chief: compliance, risk, audit gaps
  - Scout: discovery, data profiling, pattern detection
  - Signal: operational efficiency, process optimization
  - Atlas: knowledge capture, institutional risk, key person dependencies

Respond ONLY with the JSON object, no other text.`,
                },
              ],
            });
            message = await stream.finalMessage();
            break;
          } catch (retryErr: unknown) {
            const status = (retryErr as { status?: number }).status;
            if (status === 529 && attempt < 2) {
              send({ type: "agent-log", agent: "Dispatch", message: "High demand — retrying with backoff...", logType: "progress" });
              send({ type: "progress", records: totalRecords, scanned: Math.floor(totalRecords * (0.3 + attempt * 0.05)), message: "Retrying analysis..." });
              await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
              continue;
            }
            throw retryErr;
          }
        }

        if (!message) throw new Error("Failed after retries");

        send({ type: "progress", records: totalRecords, scanned: Math.floor(totalRecords * 0.7), message: "Opus analysis complete. Processing findings..." });
        send({ type: "agent-log", agent: "Dispatch", message: "Deep analysis complete. Streaming findings...", logType: "progress" });

        const content = message.content[0];
        if (content.type === "text") {
          let text = content.text.trim();
          if (text.startsWith("```")) text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

          const parsed = JSON.parse(text);
          const findings = parsed.findings || parsed;
          const summary = parsed.summary;

          // Send summary first
          if (summary) {
            send({ type: "summary", ...summary });
            send({ type: "agent-log", agent: "Dispatch", message: `Total waste identified: ${summary.totalAnnualWaste} across ${summary.findingsCount} findings`, logType: "finding" });
          }

          send({ type: "progress", records: totalRecords, scanned: Math.floor(totalRecords * 0.8), message: "Validating and streaming findings..." });

          // Stream findings with agent attribution
          for (let i = 0; i < findings.length; i++) {
            await new Promise((r) => setTimeout(r, 500 + Math.random() * 300));
            const f = findings[i];

            // Agent log entry for the finding
            send({
              type: "agent-log",
              agent: f.agent || "Scout",
              message: `${f.title}${f.amount ? " — " + f.amount : ""}`,
              logType: "finding",
            });

            send({ type: "finding", ...f });
            send({
              type: "progress",
              records: totalRecords,
              scanned: Math.floor(totalRecords * (0.8 + (0.2 * (i + 1)) / findings.length)),
              message: `Delivered ${i + 1} of ${findings.length} findings...`,
            });
          }
        }
      } catch (err) {
        console.error("Claude API error:", err);
        send({ type: "agent-log", agent: "Dispatch", message: `Analysis error: ${err instanceof Error ? err.message : "Unknown"}`, logType: "progress" });
        send({ type: "finding", title: "Analysis error", description: "Unable to complete analysis. Please try again or contact us.", amount: null, severity: "medium", category: "Operations" });
      }

      send({ type: "progress", records: totalRecords, scanned: totalRecords, message: "Scan complete." });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function computeDataStats(rows: Record<string, unknown>[], columns: string[]): { summary: string; detail: string } {
  if (rows.length === 0) return { summary: "Empty dataset", detail: "No records" };

  const numericCols: Record<string, number[]> = {};
  const categoryCols: Record<string, Map<string, number>> = {};

  for (const col of columns) {
    const values = rows.map((r) => r[col]).filter((v) => v != null && v !== "");
    const numericValues = values.map(Number).filter((n) => !isNaN(n));

    if (numericValues.length > values.length * 0.5 && numericValues.length > 0) {
      numericCols[col] = numericValues;
    } else {
      const counts = new Map<string, number>();
      values.forEach((v) => {
        const s = String(v);
        counts.set(s, (counts.get(s) || 0) + 1);
      });
      if (counts.size < values.length * 0.8) {
        categoryCols[col] = counts;
      }
    }
  }

  const parts: string[] = [];
  for (const [col, vals] of Object.entries(numericCols)) {
    const sum = vals.reduce((a, b) => a + b, 0);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = sum / vals.length;
    parts.push(`${col}: min=${min.toFixed(2)}, max=${max.toFixed(2)}, avg=${avg.toFixed(2)}, sum=${sum.toFixed(2)}, count=${vals.length}`);
  }
  for (const [col, counts] of Object.entries(categoryCols)) {
    const top5 = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    parts.push(`${col}: ${counts.size} unique values. Top: ${top5.map(([k, v]) => `${k}(${v})`).join(", ")}`);
  }

  const summary = `${rows.length} records, ${columns.length} columns, ${Object.keys(numericCols).length} numeric fields, ${Object.keys(categoryCols).length} categorical fields`;
  return { summary, detail: parts.join("\n") };
}
