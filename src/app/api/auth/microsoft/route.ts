import { NextResponse } from "next/server";

const MS_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const REDIRECT_URI = `${process.env.NEXTAUTH_URL || "https://upskiller-scanner.vercel.app"}/api/auth/microsoft/callback`;

const SCOPES = [
  "openid",
  "profile",
  "email",
  "Mail.Read",
  "Files.Read.All",
  "Calendars.Read",
  "User.Read",
].join(" ");

export async function GET() {
  if (!MS_CLIENT_ID) {
    return Response.json({ error: "Microsoft OAuth not configured" }, { status: 501 });
  }

  // Generate CSRF state token
  const csrfToken = crypto.randomUUID().slice(0, 16);
  const stateParam = `${csrfToken}:microsoft`;

  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
    `client_id=${MS_CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&response_mode=query` +
    `&state=${encodeURIComponent(stateParam)}` +
    `&prompt=consent`;

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("oauth_state", stateParam, {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/",
  });
  return response;
}
