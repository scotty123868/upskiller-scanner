import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UpSkiller Scanner — See what your systems are sitting on",
  description: "Upload your data. Get findings in minutes. No install, no IT, no commitment.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..800,0..100,0&family=Inter:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full bg-[#faf9f7] text-[#1a1a1a] antialiased" style={{ fontFamily: "'Inter', -apple-system, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
