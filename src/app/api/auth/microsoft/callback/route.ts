import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/supabase";

const MS_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const MS_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";
const REDIRECT_URI = `${process.env.NEXTAUTH_URL || "https://upskiller-scanner.vercel.app"}/api/auth/microsoft/callback`;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state") || "";

  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", request.url));
  }

  // CSRF protection: verify state parameter matches cookie
  const cookieHeader = request.headers.get("cookie") || "";
  const storedStateMatch = cookieHeader.match(/oauth_state=([^;]+)/);
  const storedState = storedStateMatch?.[1] || "";

  if (!storedState || storedState !== returnedState) {
    return NextResponse.redirect(new URL("/?error=csrf_failed", request.url));
  }

  try {
    // Exchange code for token
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      return NextResponse.redirect(new URL("/?error=auth_failed", request.url));
    }

    // Get user info from Microsoft Graph
    const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const msUser = await userRes.json();

    // Auto-create account in Supabase
    let userId = "";
    try {
      const user = await getOrCreateUser(
        msUser.mail || msUser.userPrincipalName,
        msUser.displayName,
        undefined,
        "microsoft"
      );
      userId = user.id;
    } catch {
      // Supabase might not be configured yet, proceed without persistence
    }

    const response = NextResponse.redirect(new URL("/?scan=ready&mode=microsoft", request.url));
    // Clear the CSRF state cookie
    response.cookies.set("oauth_state", "", { httpOnly: true, secure: true, sameSite: "lax", maxAge: 0, path: "/" });
    response.cookies.set("scan_token", tokens.access_token, {
      httpOnly: true, secure: true, sameSite: "lax", maxAge: 3600, path: "/",
    });
    response.cookies.set("scan_provider", "microsoft", {
      httpOnly: true, secure: true, sameSite: "lax", maxAge: 3600, path: "/",
    });
    if (userId) {
      response.cookies.set("user_id", userId, {
        httpOnly: true, secure: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60, path: "/",
      });
    }
    // Client-readable session cookie — independent of Supabase
    const msEmail = msUser.mail || msUser.userPrincipalName || "";
    if (msEmail) {
      const userPayload = Buffer.from(JSON.stringify({
        email: msEmail,
        name: msUser.displayName || "",
        avatarUrl: "",
      })).toString("base64");
      response.cookies.set("ally_user", userPayload, {
        httpOnly: false, secure: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60, path: "/",
      });
    }
    return response;
  } catch (err) {
    console.error("Microsoft OAuth error:", err);
    return NextResponse.redirect(new URL("/?error=auth_failed", request.url));
  }
}
