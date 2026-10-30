// FocusRealm Mail Merge — routes. Pages load on demand; the branded loader covers the first load
// and a thin progress bar (AppShell) covers later navigations.
import type { ComponentType } from "react";
import { createBrowserRouter, Navigate, RouterProvider, useRouteError } from "react-router-dom";
import { Compass } from "lucide-react";
import { AppShell } from "./components/layout/AppShell";
import { RequireAuth } from "./components/layout/RequireAuth";
import { BootSplash, FocusRealmLoader } from "./components/brand/FocusRealmLoader";
import { FocusRealmLogo } from "./components/brand/FocusRealmLogo";
import { Button, ButtonLink } from "./components/ui/Button";

function page<M>(load: () => Promise<M>, pick: (m: M) => ComponentType) {
  return async () => ({ Component: pick(await load()) });
}

function NotFound() {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <FocusRealmLogo size={48} className="mb-5 opacity-90" />
      <div className="mb-2 flex items-center gap-2 text-ink-subtle">
        <Compass className="h-4 w-4" />
        <span className="text-xs font-semibold uppercase tracking-wider">404</span>
      </div>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="mt-1 max-w-sm text-[13px] text-ink-subtle">The link may be old, or the item was deleted.</p>
      <ButtonLink to="/" className="mt-5">Go to overview</ButtonLink>
    </div>
  );
}

/** Last-resort screen. The usual cause is a page file from an older deploy that no longer exists. */
function RouteError() {
  const error = useRouteError();
  const stale = error instanceof Error && /dynamically imported module|Importing a module script failed|Loading chunk/i.test(error.message);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 text-center">
      <FocusRealmLogo size={48} className="mb-5" />
      <h1 className="text-lg font-semibold">{stale ? "FocusRealm Mail Merge was updated" : "Something went wrong"}</h1>
      <p className="mt-1 max-w-sm text-[13px] text-ink-subtle">
        {stale ? "Reload to get the latest version. Nothing you saved is lost." : "This screen couldn't be shown. Reloading usually fixes it."}
      </p>
      <Button variant="primary" className="mt-5" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}

const router = createBrowserRouter([
  {
    hydrateFallbackElement: <FocusRealmLoader />,
    errorElement: <RouteError />,
    children: [
      { path: "/login", lazy: page(() => import("./pages/auth/LoginPage"), (m) => m.LoginPage) },
      { path: "/accept-invite", lazy: page(() => import("./pages/auth/TokenPages"), (m) => m.AcceptInvitePage) },
      { path: "/reset-password", lazy: page(() => import("./pages/auth/TokenPages"), (m) => m.ResetPasswordPage) },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, lazy: page(() => import("./pages/OverviewPage"), (m) => m.OverviewPage) },
              { path: "campaigns", lazy: page(() => import("./pages/campaigns/CampaignsPage"), (m) => m.CampaignsPage) },
              { path: "campaigns/new", lazy: page(() => import("./pages/campaigns/CampaignFormPage"), (m) => m.CampaignFormPage) },
              { path: "campaigns/:id", lazy: page(() => import("./pages/campaigns/CampaignDetailPage"), (m) => m.CampaignDetailPage) },
              { path: "campaigns/:id/edit", lazy: page(() => import("./pages/campaigns/CampaignFormPage"), (m) => m.CampaignFormPage) },
              { path: "templates", lazy: page(() => import("./pages/templates/TemplatesPage"), (m) => m.TemplatesPage) },
              { path: "templates/new", lazy: page(() => import("./pages/templates/TemplateEditorPage"), (m) => m.TemplateEditorPage) },
              { path: "templates/:id", lazy: page(() => import("./pages/templates/TemplateEditorPage"), (m) => m.TemplateEditorPage) },
              { path: "contacts", lazy: page(() => import("./pages/audience/ContactsPage"), (m) => m.ContactsPage) },
              { path: "contacts/import", lazy: page(() => import("./pages/audience/ImportPage"), (m) => m.ImportPage) },
              { path: "lists", lazy: page(() => import("./pages/audience/ListsPage"), (m) => m.ListsPage) },
              { path: "lists/:id", lazy: page(() => import("./pages/audience/ListsPage"), (m) => m.ListDetailPage) },
              { path: "suppressions", lazy: page(() => import("./pages/audience/SuppressionsPage"), (m) => m.SuppressionsPage) },
              { path: "settings", element: <Navigate to="/settings/mailbox" replace /> },
              { path: "settings/:tab", lazy: page(() => import("./pages/settings/SettingsPage"), (m) => m.SettingsPage) },
              { path: "dashboard", element: <Navigate to="/" replace /> },
              { path: "*", element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
]);

export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <BootSplash />
    </>
  );
}
