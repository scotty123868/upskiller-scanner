import Link from "next/link";

export default function Privacy() {
  return (
    <div className="min-h-screen" style={{ background: "#faf9f7", fontFamily: "'Inter', sans-serif" }}>
      <nav className="px-5 md:px-18 h-14 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
        <Link href="/" className="font-fraunces font-medium text-base" style={{ letterSpacing: "-0.03em" }}>UpSkiller</Link>
      </nav>
      <main className="max-w-2xl mx-auto px-6 py-12 md:py-20">
        <h1 className="font-fraunces text-3xl md:text-4xl font-light mb-8" style={{ letterSpacing: "-0.03em" }}>Privacy Policy</h1>
        <div className="space-y-6 text-sm leading-relaxed" style={{ color: "#6b6560" }}>
          <p>Last updated: April 14, 2026</p>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">What we access</h2>
          <p>When you sign in with Google, UpSkiller Scanner requests read-only access to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><b className="text-[#1a1a1a]">Gmail (read-only)</b> — We scan email sender domains to discover your tech stack. For financial emails (invoices, receipts, subscriptions), we read the full email body to extract dollar amounts, vendor names, and contract details. Email content is truncated to 2,000 characters per message.</li>
            <li><b className="text-[#1a1a1a]">Google Drive (metadata only)</b> — We read file names and modification dates to find contracts, SOWs, and procurement documents. We never read file contents.</li>
            <li><b className="text-[#1a1a1a]">Google Calendar (read-only)</b> — We read meeting titles, dates, and attendee counts to identify vendor relationships and operational cadences.</li>
            <li><b className="text-[#1a1a1a]">Google Admin Directory (admin mode only)</b> — If you connect as an admin, we read organization user profiles (names, emails, departments) to map team structure and identify license usage patterns. No passwords or credentials are accessed.</li>
          </ul>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">File uploads</h2>
          <p>You may also upload spreadsheet files (CSV, XLSX, JSON) directly for analysis. Uploaded file content is processed in-memory during your scan and sent to Claude for AI analysis. The file content itself is not permanently stored, but scan results (findings, recommendations) derived from the file are saved to your account if you are signed in.</p>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">What we don&apos;t do</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>We never write to, modify, or delete anything in your Google account.</li>
            <li>We never permanently store your raw email content or uploaded file content on our servers. This data is held in memory only during your scan session.</li>
            <li>We never use your data for advertising.</li>
          </ul>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">How data is processed</h2>
          <p>During your scan, data from connected sources (email content, file uploads, calendar metadata, drive metadata, and admin directory profiles) is sent to Claude by Anthropic for AI analysis. This data is processed in real-time to produce findings and is not stored by Anthropic for model training. Scan results (findings, tech stack maps, recommendations, agent logs) are saved to our database and associated with your account. Raw source data (emails, files) is discarded after the scan completes.</p>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">Authentication tokens</h2>
          <p>Your Google OAuth token is stored in a secure, httpOnly cookie that expires after 1 hour. It is only used to access the Google APIs listed above during your active scan session. Tokens are never logged or stored in any database.</p>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">Data retention</h2>
          <p>If you create an account, your scan results (findings and recommendations) are stored in our database so you can return to them later. Your raw email content is never stored. You can request deletion of your account and all associated data at any time by emailing scotty@upskillerai.com.</p>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">Third-party services</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li><b className="text-[#1a1a1a]">Anthropic (Claude AI)</b> — We send email content (sender domains, financial email bodies truncated to 2,000 characters, extracted amounts), Drive file metadata, and calendar event summaries to Claude for analysis. Anthropic does not use this data for model training per their API terms.</li>
            <li><b className="text-[#1a1a1a]">Vercel</b> — Our application is hosted on Vercel&apos;s serverless infrastructure.</li>
            <li><b className="text-[#1a1a1a]">Supabase</b> — User accounts, scan results (findings, recommendations, agent logs), and usage tracking are stored in Supabase. Data is retained until you request deletion.</li>
          </ul>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">Your rights</h2>
          <p>You can revoke UpSkiller&apos;s access to your Google account at any time by visiting <a href="https://myaccount.google.com/permissions" className="underline text-[#3b82f6]">Google Account Permissions</a>. You can also request complete deletion of your data by contacting us.</p>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">Contact</h2>
          <p>Questions about this policy? Email <a href="mailto:scotty@upskillerai.com" className="underline text-[#3b82f6]">scotty@upskillerai.com</a>.</p>
        </div>
      </main>
    </div>
  );
}
