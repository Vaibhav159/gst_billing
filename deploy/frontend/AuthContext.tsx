/**
 * Improved AuthContext - replaces src/contexts/AuthContext.tsx
 *
 * Changes from original:
 * 1. Decodes username from JWT claims (requires backend custom serializer)
 * 2. Checks token expiration on hydration (no flash of auth state with expired token)
 * 3. Shows loading spinner during hydration instead of blank screen
 */
import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import api from "@/utils/api";
import { jwtDecode } from "jwt-decode";
import { Loader2 } from "lucide-react";

export interface AppUser {
  id: string;
  username: string;
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

interface JWTPayload {
  user_id: string;
  username?: string;
  exp: number;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const accessToken = localStorage.getItem(ACCESS_KEY);
    if (accessToken) {
      try {
        const decoded = jwtDecode<JWTPayload>(accessToken);

        // Check if token is expired
        const now = Date.now() / 1000;
        if (decoded.exp && decoded.exp < now) {
          // Token expired - clear and stay logged out
          localStorage.removeItem(ACCESS_KEY);
          localStorage.removeItem(REFRESH_KEY);
        } else {
          // Token valid - hydrate user with username from JWT
          setUser({
            id: decoded.user_id,
            username: decoded.username || "User",
          });
        }
      } catch {
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

      const decoded = jwtDecode<JWTPayload>(access);
      setUser({
        id: decoded.user_id,
        username: decoded.username || username,
      });

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
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {isLoading ? (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
