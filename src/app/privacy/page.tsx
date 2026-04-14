export default function Privacy() {
  return (
    <div className="min-h-screen" style={{ background: "#faf9f7", fontFamily: "'Inter', sans-serif" }}>
      <nav className="px-5 md:px-18 h-14 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
        <a href="/" className="font-fraunces font-medium text-base" style={{ letterSpacing: "-0.03em" }}>UpSkiller</a>
      </nav>
      <main className="max-w-2xl mx-auto px-6 py-12 md:py-20">
        <h1 className="font-fraunces text-3xl md:text-4xl font-light mb-8" style={{ letterSpacing: "-0.03em" }}>Privacy Policy</h1>
        <div className="space-y-6 text-sm leading-relaxed" style={{ color: "#6b6560" }}>
          <p>Last updated: April 14, 2026</p>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">What we access</h2>
          <p>When you sign in with Google, UpSkiller Scanner requests read-only access to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><b className="text-[#1a1a1a]">Gmail (read-only)</b> — We scan email sender domains and financial email content (invoices, receipts, subscriptions) to discover your tech stack and estimate costs.</li>
            <li><b className="text-[#1a1a1a]">Google Drive (metadata only)</b> — We read file names and modification dates to find contracts, SOWs, and procurement documents. We never read file contents.</li>
            <li><b className="text-[#1a1a1a]">Google Calendar (read-only)</b> — We analyze meeting patterns to identify vendor relationships and operational cadences.</li>
          </ul>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">What we don't do</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>We never write to, modify, or delete anything in your Google account.</li>
            <li>We never store your email content, file contents, or calendar details on our servers.</li>
            <li>We never share your data with third parties.</li>
            <li>We never use your data for advertising or training AI models.</li>
          </ul>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">How data is processed</h2>
          <p>All data is processed in-memory during your scan session. Email content is analyzed by our AI (Claude by Anthropic) to produce findings, then immediately discarded. Only the scan results (findings, tech stack map, recommendations) are shown to you. Raw email data is never stored.</p>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">Authentication tokens</h2>
          <p>Your Google OAuth token is stored in a secure, httpOnly cookie that expires after 1 hour. It is only used to access the Google APIs listed above during your active scan session. Tokens are never logged or stored in any database.</p>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">Data retention</h2>
          <p>If you create an account, your scan results (findings and recommendations) are stored in our database so you can return to them later. Your raw email content is never stored. You can request deletion of your account and all associated data at any time by emailing scotty@upskillerai.com.</p>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">Third-party services</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li><b className="text-[#1a1a1a]">Anthropic (Claude AI)</b> — We send anonymized, summarized data to Claude for analysis. No raw email content is sent.</li>
            <li><b className="text-[#1a1a1a]">Vercel</b> — Our application is hosted on Vercel's serverless infrastructure.</li>
            <li><b className="text-[#1a1a1a]">Supabase</b> — Scan results are stored in Supabase (if you create an account).</li>
          </ul>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">Your rights</h2>
          <p>You can revoke UpSkiller's access to your Google account at any time by visiting <a href="https://myaccount.google.com/permissions" className="underline text-[#3b82f6]">Google Account Permissions</a>. You can also request complete deletion of your data by contacting us.</p>

          <h2 className="text-lg font-semibold text-[#1a1a1a] pt-4">Contact</h2>
          <p>Questions about this policy? Email <a href="mailto:scotty@upskillerai.com" className="underline text-[#3b82f6]">scotty@upskillerai.com</a>.</p>
        </div>
      </main>
    </div>
  );
}
