import { google } from "googleapis";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "personal";

  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", request.url));
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXTAUTH_URL || "https://upskiller-scanner.vercel.app"}/api/auth/callback`
  );

  try {
    const { tokens } = await oauth2Client.getToken(code);
    // Redirect back to the app with the token (stored in a short-lived cookie)
    const response = NextResponse.redirect(new URL(`/?scan=ready&mode=${state}`, request.url));
    response.cookies.set("scan_token", tokens.access_token || "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 3600, // 1 hour
      path: "/",
    });
    return response;
  } catch (err) {
    console.error("OAuth callback error:", err);
    return NextResponse.redirect(new URL("/?error=auth_failed", request.url));
  }
}
