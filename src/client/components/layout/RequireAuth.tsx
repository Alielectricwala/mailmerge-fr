// Route guards: signed-in area, and permission-gated pages
import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ServerCrash, ShieldOff } from "lucide-react";
import { useAuth } from "../../lib/auth";
import type { Permission } from "@shared/auth";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/Feedback";
import { FocusRealmLoader } from "../brand/FocusRealmLoader";
import { BrandLockup } from "./Brand";

export function RequireAuth() {
  const { status, error, retry, signedOut } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return <FocusRealmLoader status="Checking your session…" />;
  }
  if (status === "unavailable") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4">
        <BrandLockup size="lg" className="mb-6" />
        <EmptyState
          icon={ServerCrash}
          title="Can't reach FocusRealm Mail Merge"
          description={error ?? "The server didn't respond."}
          action={<Button variant="primary" onClick={retry}>Try again</Button>}
        />
      </div>
    );
  }
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={signedOut ? undefined : { from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

/** Hides a whole page from roles that lack the permission (the API refuses them anyway) */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (can(permission)) return <>{children}</>;
  return <EmptyState icon={ShieldOff} title="Founders only" description="Your role doesn't include this area. Ask a founder if you need access." />;
}

export function Can({ permission, children, fallback = null }: { permission: Permission; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useAuth();
  return <>{can(permission) ? children : fallback}</>;
}
