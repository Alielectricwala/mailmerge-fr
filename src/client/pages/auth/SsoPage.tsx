// /sso?launch=<ticket> — where the Focus Realm Workspace sends people who open Mail Merge.
// Exchanges the single-use launch ticket for a session, then opens the app.
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { buttonClasses } from "../../components/ui/Button";
import { Callout } from "../../components/ui/Feedback";
import { FocusRealmLoader } from "../../components/brand/FocusRealmLoader";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { hubLinks, useAuthMode } from "../../lib/hub";
import { useTitle } from "../../lib/hooks";
import type { SessionUser } from "@shared/auth";

export function SsoPage() {
  useTitle("Signing in");
  const [params] = useSearchParams();
  const ticket = params.get("launch") ?? "";
  const navigate = useNavigate();
  const { adopt } = useAuth();
  const mode = useAuthMode();
  // A ticket works once: no retries, and never refetched (React Query also dedupes StrictMode's double mount)
  const exchange = useQuery({
    queryKey: ["auth", "sso", ticket],
    queryFn: async () => (await api.get<SessionUser>(`/api/auth/hub?launch=${encodeURIComponent(ticket)}`)).data,
    enabled: Boolean(ticket),
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!exchange.data) return;
    adopt(exchange.data);
    navigate("/", { replace: true });
  }, [exchange.data, adopt, navigate]);

  if (ticket && !exchange.isError) return <FocusRealmLoader status="Signing you in…" />;

  const hubUrl = mode.data?.hubUrl;
  return (
    <AuthLayout
      title="Couldn't sign you in"
      footer={hubUrl ? "Still stuck? Sign out of the Workspace and back in, then open Mail Merge again." : undefined}
    >
      <div className="space-y-5">
        <Callout tone="warning">{exchange.error ? errorMessage(exchange.error) : "This link is missing its sign-in ticket. Open Mail Merge from the Workspace."}</Callout>
        {hubUrl && (
          <a href={hubLinks(hubUrl).signIn} className={buttonClasses("primary", "md", "h-10 w-full")}>
            Open Mail Merge from the Workspace
          </a>
        )}
      </div>
    </AuthLayout>
  );
}
