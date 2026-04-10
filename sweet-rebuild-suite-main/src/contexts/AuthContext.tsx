import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import api from "@/utils/api";
import { jwtDecode } from "jwt-decode";
import { useToast } from "@/hooks/use-toast";

export interface AppUser {
  id: string; // From jwt payload
  username: string; // The active username
}

interface AuthContextType {
  user: AppUser | null;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const ACCESS_KEY = "gst_access_token";
const REFRESH_KEY = "gst_refresh_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    // Attempt to hydrate user from token on startup
    const accessToken = localStorage.getItem(ACCESS_KEY);
    if (accessToken) {
      try {
        const decoded = jwtDecode<{ user_id: string; username?: string; full_name?: string }>(accessToken);
        setUser({ id: decoded.user_id, username: decoded.username || decoded.full_name || "User" });
      } catch (e) {
        localStorage.removeItem(ACCESS_KEY);
        localStorage.removeItem(REFRESH_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (username: string, password: string) => {
    try {
      const response = await api.post("token/", { username, password });
      
      const { access, refresh } = response.data;
      localStorage.setItem(ACCESS_KEY, access);
      localStorage.setItem(REFRESH_KEY, refresh);

      const decoded = jwtDecode<{ user_id: string; username?: string; full_name?: string }>(access);
      setUser({ id: decoded.user_id, username: decoded.username || decoded.full_name || username });

      return { success: true };
    } catch (error: any) {
      console.error("Login Error", error);
      let errorMsg = "Login failed";
      if (error.response?.data?.detail) {
        errorMsg = error.response.data.detail;
      } else if (error.response?.status === 401) {
        errorMsg = "Invalid credentials";
      }
      return { success: false, error: errorMsg };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    // Let the router bounce the user visually, or redirect:
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {!isLoading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
