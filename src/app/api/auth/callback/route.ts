import { google } from "googleapis";
import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/supabase";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state") || "";

  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", request.url));
  }

  // CSRF protection: verify state parameter matches what we stored in cookie
  const cookieHeader = request.headers.get("cookie") || "";
  const storedStateMatch = cookieHeader.match(/oauth_state=([^;]+)/);
  const storedState = storedStateMatch?.[1] || "";

  if (!storedState || storedState !== returnedState) {
    return NextResponse.redirect(new URL("/?error=csrf_failed", request.url));
  }

  // Extract mode from state (format: "csrftoken:mode")
  const state = storedState.split(":")[1] || "crawl";

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXTAUTH_URL || "https://upskiller-scanner.vercel.app"}/api/auth/callback`
  );

  try {
    const { tokens } = await oauth2Client.getToken(code);

    // Get user info from Google
    oauth2Client.setCredentials({ access_token: tokens.access_token });
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    let email = "";
    let name = "";
    let avatarUrl = "";
    try {
      const userInfo = await oauth2.userinfo.get();
      email = userInfo.data.email || "";
      name = userInfo.data.name || "";
      avatarUrl = userInfo.data.picture || "";
    } catch {
      // userinfo may fail, continue without
    }

    // Auto-create account in Supabase
    let userId = "";
    if (email) {
      try {
        const user = await getOrCreateUser(email, name, avatarUrl, "google");
        userId = user.id;
      } catch {
        // Supabase might not be configured, proceed without persistence
      }
    }

    const response = NextResponse.redirect(new URL(`/?scan=ready&mode=${state}`, request.url));
    // Clear the CSRF state cookie
    response.cookies.set("oauth_state", "", { httpOnly: true, secure: true, sameSite: "lax", maxAge: 0, path: "/" });
    response.cookies.set("scan_token", tokens.access_token || "", {
      httpOnly: true, secure: true, sameSite: "lax", maxAge: 3600, path: "/",
    });
    response.cookies.set("scan_provider", "google", {
      httpOnly: true, secure: true, sameSite: "lax", maxAge: 3600, path: "/",
    });
    if (userId) {
      // 30 day session so users stay logged in across visits
      response.cookies.set("user_id", userId, {
        httpOnly: true, secure: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60, path: "/",
      });
    }
    // Client-readable session cookie. Independent of Supabase so session
    // persistence works even if DB is misconfigured or slow.
    // Base64-encoded JSON of user info; NOT a security boundary, just UI state.
    if (email) {
      const userPayload = Buffer.from(JSON.stringify({ email, name, avatarUrl })).toString("base64");
      response.cookies.set("ally_user", userPayload, {
        httpOnly: false, secure: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60, path: "/",
      });
    }
    return response;
  } catch (err) {
    console.error("OAuth callback error:", err);
    return NextResponse.redirect(new URL("/?error=auth_failed", request.url));
  }
}
