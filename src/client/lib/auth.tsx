// Signed-in user state, permission checks for the UI (the server enforces the same rules)
import { createContext, useContext, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { canAct, type LoginInput, type Permission, type SessionUser } from "@shared/auth";

export type AuthStatus = "loading" | "authenticated" | "anonymous" | "unavailable";

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  /** Why the session check failed when status is "unavailable" */
  error: string | null;
  /** True after an explicit sign-out, so the next sign-in doesn't return to the last page */
  signedOut: boolean;
  can: (permission: Permission) => boolean;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  /** After accepting an invite / resetting a password the server already set the session */
  refresh: () => Promise<unknown>;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const meQueryKey = ["auth", "me"] as const;

const USER_STORAGE_KEY = "fr_auth_user";

function getCachedUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCachedUser(user: SessionUser | null) {
  try {
    if (user) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

async function fetchMe(): Promise<SessionUser | null> {
  try {
    const user = (await api.get<SessionUser>("/api/auth/me")).data;
    setCachedUser(user);
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      setCachedUser(null);
      return null;
    }
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: meQueryKey,
    queryFn: fetchMe,
    initialData: () => getCachedUser() ?? undefined,
    staleTime: 60_000,
    retry: 1,
  });
  const [signedOut, setSignedOut] = useState(false);

  const login = useMutation({
    mutationFn: (input: LoginInput) => api.post<SessionUser>("/api/auth/login", input),
    onSuccess: (res) => {
      setSignedOut(false);
      setCachedUser(res.data);
      qc.setQueryData(meQueryKey, res.data);
    },
  });
  const logout = useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    onSettled: () => {
      setSignedOut(true);
      setCachedUser(null);
      qc.clear();
      qc.setQueryData(meQueryKey, null);
    },
  });

  const status: AuthStatus = me.isPending ? "loading" : me.isError ? "unavailable" : me.data ? "authenticated" : "anonymous";
  const user = me.data ?? null;

  const value: AuthContextValue = {
    status,
    user,
    error: me.error ? (me.error as Error).message : null,
    signedOut,
    can: (p) => (user ? canAct(user, p) : false),
    login: async (input) => {
      await login.mutateAsync(input);
    },
    logout: async () => {
      await logout.mutateAsync();
    },
    refresh: () => qc.invalidateQueries({ queryKey: meQueryKey }),
    retry: () => void me.refetch(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
