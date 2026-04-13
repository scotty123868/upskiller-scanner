"use client";

import { useState, useCallback, useRef } from "react";

type Finding = {
  id: number;
  title: string;
  description: string;
  amount: string | null;
  severity: "critical" | "high" | "medium";
  category: string;
};

type ScanState = "idle" | "uploading" | "scanning" | "done";

export default function Home() {
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [scanProgress, setScanProgress] = useState({ records: 0, scanned: 0, message: "" });
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState("");
  const [totalSavings, setTotalSavings] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setScanState("uploading");
    setFindings([]);
    setTotalSavings(0);

    const formData = new FormData();
    formData.append("file", file);

    setTimeout(() => setScanState("scanning"), 800);

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Scan failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let findingId = 0;

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") {
            setScanState("done");
            continue;
          }

          try {
            const event = JSON.parse(data);
            if (event.type === "progress") {
              setScanProgress(event);
            } else if (event.type === "finding") {
              findingId++;
              const finding: Finding = { id: findingId, ...event };
              setFindings((prev) => [...prev, finding]);
              if (event.amount) {
                const num = parseInt(event.amount.replace(/[^0-9]/g, ""));
                if (!isNaN(num)) setTotalSavings((prev) => prev + num);
              }
            }
          } catch {
            // skip malformed JSON
          }
        }
      }
    } catch (err) {
      console.error("Scan error:", err);
      setScanState("idle");
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  }, []);

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-8 md:px-18 h-15 flex items-center justify-between" style={{ background: "rgba(250,249,247,0.88)", backdropFilter: "blur(24px)", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
        <a href="https://upskillerai.com" className="font-fraunces font-medium text-lg" style={{ letterSpacing: "-0.03em" }}>
          UpSkiller
        </a>
        <div className="flex items-center gap-6">
          <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "#a8a29e" }}>
            Scanner
          </span>
          <a href="mailto:scotty@upskillerai.com" className="text-sm font-semibold px-5 py-2.5 rounded-full bg-[#1a1a1a] text-[#faf9f7] hover:bg-[#333] transition-all">
            Talk to us
          </a>
        </div>
      </nav>

      {/* Main content */}
      <main className="pt-32 px-8 md:px-18 max-w-5xl mx-auto">
        {scanState === "idle" && <IdleState dragActive={dragActive} handleDrag={handleDrag} handleDrop={handleDrop} fileInputRef={fileInputRef} handleFile={handleFile} />}
        {scanState === "uploading" && <UploadingState fileName={fileName} />}
        {scanState === "scanning" && <ScanningState progress={scanProgress} findings={findings} totalSavings={totalSavings} fileName={fileName} />}
        {scanState === "done" && <DoneState findings={findings} totalSavings={totalSavings} fileName={fileName} onReset={() => { setScanState("idle"); setFindings([]); setTotalSavings(0); }} />}
      </main>

      {/* Footer */}
      <footer className="mt-32 px-8 md:px-18 py-8 flex justify-between items-center" style={{ borderTop: "1px solid #ddd8d0" }}>
        <span className="text-xs" style={{ color: "#a8a29e" }}>&copy; 2026 UpSkiller AI</span>
        <div className="flex gap-6">
          <a href="https://upskillerai.com" className="text-xs hover:text-[#1a1a1a] transition-colors" style={{ color: "#a8a29e" }}>Home</a>
          <a href="mailto:scotty@upskillerai.com" className="text-xs hover:text-[#1a1a1a] transition-colors" style={{ color: "#a8a29e" }}>Contact</a>
        </div>
      </footer>
    </div>
  );
}

function IdleState({ dragActive, handleDrag, handleDrop, fileInputRef, handleFile }: {
  dragActive: boolean;
  handleDrag: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFile: (file: File) => void;
}) {
  return (
    <div className="animate-fade-up">
      <h1 className="font-fraunces text-4xl md:text-5xl font-light leading-tight" style={{ letterSpacing: "-0.045em" }}>
        Drop your data.<br />See what you're sitting on.
      </h1>
      <p className="mt-6 text-base leading-relaxed max-w-lg" style={{ color: "#6b6560" }}>
        Upload a CSV or Excel file — AP invoices, vendor lists, license exports, employee rosters, equipment logs. Our agents scan it and surface findings in minutes. Read-only. No install. No commitment.
      </p>

      {/* Upload zone */}
      <div
        className={`mt-12 border-2 border-dashed rounded-xl p-16 text-center transition-all cursor-pointer ${
          dragActive ? "border-[#c4501e] bg-[#c4501e]/5" : "border-[#ddd8d0] hover:border-[#a8a29e]"
        }`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(196,80,30,0.08)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c4501e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div>
            <p className="font-medium text-sm">Drop a file here, or click to browse</p>
            <p className="mt-1 text-xs" style={{ color: "#a8a29e" }}>CSV, Excel (.xlsx), or JSON — up to 50MB</p>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".csv,.xlsx,.xls,.json,.tsv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      {/* Data type suggestions */}
      <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "AP Invoices", desc: "Find duplicate payments & overcharges" },
          { label: "Vendor List", desc: "Spot redundant contracts & pricing gaps" },
          { label: "Software Licenses", desc: "Surface unused seats & renewals" },
          { label: "Equipment Log", desc: "Identify idle assets & redundant rentals" },
        ].map((item) => (
          <div key={item.label} className="p-4 rounded-lg" style={{ border: "1px solid #ddd8d0" }}>
            <p className="text-sm font-medium">{item.label}</p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: "#a8a29e" }}>{item.desc}</p>
          </div>
        ))}
      </div>

      {/* Trust signals */}
      <div className="mt-16 flex items-center gap-8 flex-wrap">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span className="text-xs" style={{ color: "#6b6560" }}>Read-only analysis</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span className="text-xs" style={{ color: "#6b6560" }}>Data deleted after scan</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span className="text-xs" style={{ color: "#6b6560" }}>Results in under 5 minutes</span>
        </div>
      </div>
    </div>
  );
}

function UploadingState({ fileName }: { fileName: string }) {
  return (
    <div className="animate-fade-up flex flex-col items-center justify-center py-32">
      <div className="w-12 h-12 rounded-full border-2 border-[#ddd8d0] border-t-[#c4501e] animate-spin" />
      <p className="mt-6 font-medium text-sm">Uploading {fileName}...</p>
    </div>
  );
}

function ScanningState({ progress, findings, totalSavings, fileName }: {
  progress: { records: number; scanned: number; message: string };
  findings: Finding[];
  totalSavings: number;
  fileName: string;
}) {
  return (
    <div className="animate-fade-up">
      {/* Scan header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-fraunces text-3xl font-light" style={{ letterSpacing: "-0.03em" }}>Scanning {fileName}</h2>
          <p className="mt-2 text-sm" style={{ color: "#6b6560" }}>{progress.message || "Analyzing records..."}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#c4501e] animate-pulse-dot" />
          <span className="text-xs font-semibold tracking-wider uppercase" style={{ color: "#c4501e" }}>Scanning</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-6 h-1 rounded-full overflow-hidden" style={{ background: "#ddd8d0" }}>
        <div
          className="h-full rounded-full bg-[#c4501e] transition-all duration-1000 ease-out"
          style={{ width: progress.records > 0 ? `${Math.min((progress.scanned / progress.records) * 100, 95)}%` : "15%" }}
        />
      </div>

      {/* Stats bar */}
      <div className="mt-4 flex items-center gap-8">
        <span className="text-xs tabular-nums" style={{ color: "#a8a29e" }}>
          <b className="text-[#6b6560] font-semibold">{progress.scanned.toLocaleString()}</b> / {progress.records.toLocaleString()} records
        </span>
        <span className="text-xs tabular-nums" style={{ color: "#a8a29e" }}>
          <b className="text-[#6b6560] font-semibold">{findings.length}</b> findings
        </span>
        {totalSavings > 0 && (
          <span className="text-xs tabular-nums" style={{ color: "#a8a29e" }}>
            <b className="text-[#c4501e] font-semibold">${totalSavings.toLocaleString()}K</b> surfaced
          </span>
        )}
      </div>

      {/* Findings stream */}
      <div className="mt-10">
        <FindingsList findings={findings} />
      </div>
    </div>
  );
}

function DoneState({ findings, totalSavings, fileName, onReset }: {
  findings: Finding[];
  totalSavings: number;
  fileName: string;
  onReset: () => void;
}) {
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const highCount = findings.filter((f) => f.severity === "high").length;

  return (
    <div className="animate-fade-up">
      {/* Summary header */}
      <div className="flex items-start justify-between gap-8 flex-wrap">
        <div>
          <h2 className="font-fraunces text-3xl md:text-4xl font-light" style={{ letterSpacing: "-0.03em" }}>
            Scan complete.
          </h2>
          <p className="mt-3 text-sm leading-relaxed max-w-md" style={{ color: "#6b6560" }}>
            We analyzed <b className="text-[#1a1a1a] font-medium">{fileName}</b> and found {findings.length} actionable findings.
            {totalSavings > 0 && <> Estimated annualized impact: <b className="text-[#c4501e] font-semibold">${totalSavings.toLocaleString()}K</b>.</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onReset} className="text-sm font-medium px-5 py-2.5 rounded-full transition-all hover:bg-[#f0ede8]" style={{ border: "1px solid #ddd8d0", color: "#6b6560" }}>
            Scan another file
          </button>
          <a href="mailto:scotty@upskillerai.com?subject=Scanner%20results%20—%20want%20to%20learn%20more" className="text-sm font-semibold px-5 py-2.5 rounded-full bg-[#1a1a1a] text-[#faf9f7] hover:bg-[#333] transition-all">
            Talk to us about these findings
          </a>
        </div>
      </div>

      {/* Summary stats */}
      <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Findings" value={findings.length.toString()} />
        <StatCard label="Critical" value={criticalCount.toString()} color="#c4501e" />
        <StatCard label="High Impact" value={highCount.toString()} color="#f59e0b" />
        <StatCard label="Est. Annual Impact" value={totalSavings > 0 ? `$${totalSavings.toLocaleString()}K` : "—"} color="#c4501e" />
      </div>

      {/* Findings list */}
      <div className="mt-10">
        <FindingsList findings={findings} />
      </div>

      {/* CTA */}
      <div className="mt-16 p-8 rounded-xl" style={{ background: "#1a1a1a" }}>
        <h3 className="font-fraunces text-xl font-light text-white/90" style={{ letterSpacing: "-0.02em" }}>
          This is from one file. Imagine what we'd find across all your systems.
        </h3>
        <p className="mt-3 text-sm text-white/40 max-w-md leading-relaxed">
          Two-week engagement. Fixed fee. Read-only access to your actual systems. We connect to everything and surface findings like these, at scale.
        </p>
        <a href="mailto:scotty@upskillerai.com?subject=Full%20engagement%20—%20scanner%20results%20were%20compelling" className="mt-6 inline-flex text-sm font-semibold px-6 py-3 rounded-full bg-[#faf9f7] text-[#1a1a1a] hover:bg-[#eee] transition-all">
          Schedule a walkthrough
        </a>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="p-5 rounded-lg" style={{ border: "1px solid #ddd8d0" }}>
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#a8a29e" }}>{label}</p>
      <p className="mt-2 font-fraunces text-2xl font-light" style={{ letterSpacing: "-0.03em", color: color || "#1a1a1a" }}>{value}</p>
    </div>
  );
}

function FindingsList({ findings }: { findings: Finding[] }) {
  const severityColor = {
    critical: { bg: "rgba(196,80,30,0.08)", text: "#c4501e" },
    high: { bg: "rgba(245,158,11,0.08)", text: "#f59e0b" },
    medium: { bg: "rgba(59,130,246,0.08)", text: "#3b82f6" },
  };

  return (
    <div className="space-y-3">
      {findings.map((f, i) => (
        <div
          key={f.id}
          className="p-5 rounded-lg animate-fade-up"
          style={{ border: "1px solid #ddd8d0", animationDelay: `${i * 0.05}s` }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span
                  className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded"
                  style={{
                    background: severityColor[f.severity].bg,
                    color: severityColor[f.severity].text,
                  }}
                >
                  {f.severity}
                </span>
                <span className="text-xs uppercase tracking-wider font-medium" style={{ color: "#a8a29e" }}>
                  {f.category}
                </span>
              </div>
              <h4 className="mt-2 text-sm font-semibold">{f.title}</h4>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: "#6b6560" }}>{f.description}</p>
            </div>
            {f.amount && (
              <div className="text-right flex-shrink-0">
                <p className="font-fraunces text-xl font-light" style={{ color: "#c4501e", letterSpacing: "-0.02em" }}>
                  {f.amount}
                </p>
                <p className="text-xs" style={{ color: "#a8a29e" }}>/year</p>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
