import { supabase } from "@/integrations/supabase/client";

export interface AdminSession {
  email: string;
  loginTime: number;
  sessionToken: string; // issued by admin_login; every admin RPC checks it server-side
}

const ADMIN_SESSION_KEY = "admin_session";
const SESSION_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours, same as the server-side session

export async function authenticateAdmin(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // The server checks the password and returns a session token (null = wrong email/password)
    const { data: token, error } = await supabase.rpc("admin_login", {
      p_email: email.trim().toLowerCase(),
      p_password: password,
    });

    if (error) {
      console.error("Authentication error:", error);
      return { success: false, error: "Authentication failed" };
    }

    if (token) {
      const session: AdminSession = { email: email.trim().toLowerCase(), loginTime: Date.now(), sessionToken: token };
      sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
      return { success: true };
    }

    return { success: false, error: "Invalid email or password" };
  } catch (error) {
    console.error("Authentication error:", error);
    return { success: false, error: "Connection error. Please try again" };
  }
}

export function getAdminSession(): AdminSession | null {
  try {
    const sessionStr = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!sessionStr) return null;

    const session: AdminSession = JSON.parse(sessionStr);

    // Validate session structure
    if (!session.email || !session.loginTime || !session.sessionToken) {
      clearAdminSession();
      return null;
    }

    // Check if session has expired
    if (Date.now() - session.loginTime > SESSION_TIMEOUT) {
      clearAdminSession();
      return null;
    }

    return session;
  } catch {
    clearAdminSession();
    return null;
  }
}

export function clearAdminSession(): void {
  const token = getStoredToken();
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  if (token) supabase.rpc("admin_logout", { p_token: token }).then(() => {}); // fire and forget: kill it server-side too
}

function getStoredToken(): string | null {
  try {
    return JSON.parse(sessionStorage.getItem(ADMIN_SESSION_KEY) || "null")?.sessionToken ?? null;
  } catch {
    return null;
  }
}

export function isAdminAuthenticated(): boolean {
  return getAdminSession() !== null;
}

export async function changeAdminPassword(
  email: string,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.rpc("update_admin_password" as any, {
      p_email: email,
      p_current_password: currentPassword,
      p_new_password: newPassword,
    });

    if (error) {
      console.error("Password change error:", error);
      return { success: false, error: "Failed to change password" };
    }

    if (data === true) return { success: true }; // the server logs the change

    return { success: false, error: "Current password is incorrect" };
  } catch (error) {
    console.error("Password change error:", error);
    return { success: false, error: "Connection error. Please try again" };
  }
}
