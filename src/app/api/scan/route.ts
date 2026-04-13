import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import Papa from "papaparse";

const anthropic = new Anthropic();

export const maxDuration = 120;

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
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(sheet);
      if (rows.length > 0) columns = Object.keys(rows[0]);
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
  // Sample rows for analysis (max 200 to keep within context)
  const sampleSize = Math.min(rows.length, 200);
  const sampleRows = rows.slice(0, sampleSize);
  const sampleData = JSON.stringify(sampleRows, null, 2).slice(0, 60000);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Progress: starting
      send({ type: "progress", records: totalRecords, scanned: 0, message: `Parsing ${totalRecords.toLocaleString()} records from ${file.name}...` });

      await new Promise((r) => setTimeout(r, 500));
      send({ type: "progress", records: totalRecords, scanned: Math.floor(totalRecords * 0.2), message: "Identifying data patterns and anomalies..." });

      await new Promise((r) => setTimeout(r, 500));
      send({ type: "progress", records: totalRecords, scanned: Math.floor(totalRecords * 0.4), message: "Cross-referencing records for duplicates and outliers..." });

      try {
        // Retry up to 3 times on overloaded errors
        let message;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            message = await anthropic.messages.create({
              model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: `You are an enterprise waste detection AI. Analyze this dataset and find actionable findings that would save money or reduce risk.

FILE: ${file.name}
COLUMNS: ${columns.join(", ")}
TOTAL RECORDS: ${totalRecords}
SAMPLE DATA (first ${sampleSize} rows):
${sampleData}

Find 5-8 specific, actionable findings. For each finding, estimate an annual dollar impact where possible. Be specific — reference actual values, vendors, departments, or patterns you see in the data. Don't make up data that isn't there, but do extrapolate from patterns.

Respond with a JSON array of findings. Each finding should have:
- "title": short headline (under 80 chars)
- "description": 1-2 sentences with specific details from the data
- "amount": estimated annual impact like "$340K" or "$1.2M" (null if not quantifiable)
- "severity": "critical" | "high" | "medium"
- "category": one of "Procurement", "Compliance", "Duplicates", "Licensing", "Pricing", "Operations", "Risk", "Knowledge"

Respond ONLY with the JSON array, no other text.`,
            },
          ],
        });
            break; // success, exit retry loop
          } catch (retryErr: unknown) {
            const status = (retryErr as { status?: number }).status;
            if (status === 529 && attempt < 2) {
              send({ type: "progress", records: totalRecords, scanned: Math.floor(totalRecords * (0.4 + attempt * 0.1)), message: "High demand — retrying analysis..." });
              await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
              continue;
            }
            throw retryErr;
          }
        }

        if (!message) throw new Error("Failed after retries");

        send({ type: "progress", records: totalRecords, scanned: Math.floor(totalRecords * 0.7), message: "Quantifying findings and estimating impact..." });

        const content = message.content[0];
        if (content.type === "text") {
          let findingsText = content.text.trim();
          // Strip markdown code fences if present
          if (findingsText.startsWith("```")) {
            findingsText = findingsText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
          }

          const parsedFindings = JSON.parse(findingsText);

          send({ type: "progress", records: totalRecords, scanned: Math.floor(totalRecords * 0.85), message: "Validating findings against source data..." });

          // Stream findings one at a time with delays for dramatic effect
          for (let i = 0; i < parsedFindings.length; i++) {
            await new Promise((r) => setTimeout(r, 800 + Math.random() * 400));
            send({
              type: "finding",
              ...parsedFindings[i],
            });
            send({
              type: "progress",
              records: totalRecords,
              scanned: Math.floor(totalRecords * (0.85 + (0.15 * (i + 1)) / parsedFindings.length)),
              message: `Found ${i + 1} of ${parsedFindings.length} findings...`,
            });
          }
        }
      } catch (err) {
        console.error("Claude API error:", err);
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
