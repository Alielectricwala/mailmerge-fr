// How this deployment signs people in: directly, or through the Focus Realm Workspace (hub mode)
import { useQuery } from "@tanstack/react-query";
import type { AuthModeDto } from "@shared/hub";
import { api } from "./api";

export const authModeQueryKey = ["auth", "mode"] as const;

export function useAuthMode() {
  return useQuery({
    queryKey: authModeQueryKey,
    queryFn: async () => (await api.get<AuthModeDto>("/api/auth/mode")).data,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Links to the other Focus Realm apps on the hub (the Workspace handles access to each) */
export const hubLinks = (hubUrl: string) => ({
  workspace: `${hubUrl}/`,
  hrConsole: `${hubUrl}/launch/hr`,
  signIn: `${hubUrl}/launch/mail`,
});
