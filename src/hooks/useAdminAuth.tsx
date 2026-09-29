import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  authenticateAdmin,
  getAdminSession,
  clearAdminSession,
  isAdminAuthenticated,
  AdminSession,
} from "@/lib/adminAuth";

export function useAdminAuth() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  // The interval reads the session through a ref: getAdminSession() returns a new object on every call,
  // so putting `session` in the effect's dependencies re-ran it forever and froze the admin login.
  const sessionRef = useRef<AdminSession | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    setSession(getAdminSession());
    setIsLoading(false);

    // Every minute: if a logged-in session has expired, go back to the login page
    const interval = setInterval(() => {
      if (sessionRef.current && !getAdminSession()) {
        setSession(null);
        navigate("/admindashboard/login");
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [navigate]);

  const login = async (email: string, password: string) => {
    const result = await authenticateAdmin(email, password);
    if (result.success) {
      const newSession = getAdminSession();
      setSession(newSession);
      return { success: true };
    }
    return result;
  };

  const logout = () => {
    clearAdminSession();
    setSession(null);
    navigate("/admindashboard/login");
  };

  const requireAuth = () => {
    if (!isAdminAuthenticated()) {
      navigate("/admindashboard/login");
      return false;
    }
    return true;
  };

  return {
    session,
    isLoading,
    isAuthenticated: !!session,
    login,
    logout,
    requireAuth,
  };
}
