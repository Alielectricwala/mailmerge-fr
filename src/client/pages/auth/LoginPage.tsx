import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { Button, buttonClasses } from "../../components/ui/Button";
import { PasswordField, TextField } from "../../components/ui/Field";
import { FocusRealmLoader } from "../../components/brand/FocusRealmLoader";
import { Callout } from "../../components/ui/Feedback";
import { useAuth } from "../../lib/auth";
import { hubLinks, useAuthMode } from "../../lib/hub";
import { api, errorMessage } from "../../lib/api";
import { useTitle } from "../../lib/hooks";
import { LoginSchema, SimpleSignInSchema, type SessionUser } from "@shared/auth";

function PasswordForm({ from }: { from: string }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState(false);

  if (entering) return <FocusRealmLoader status="Opening your workspace…" />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = LoginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      setFieldErrors({ email: f.email?.[0], password: f.password?.[0] });
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      setEntering(true);
      await login(parsed.data);
      // A short branded hand-off into the workspace
      await new Promise((r) => setTimeout(r, 700));
      navigate(from, { replace: true });
    } catch (err) {
      setEntering(false);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <TextField label="Email" type="email" autoComplete="email" autoFocus placeholder="name@company.com" className="h-10" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email} />
      <PasswordField label="Password" autoComplete="current-password" className="h-10" value={password} onChange={(e) => setPassword(e.target.value)} error={fieldErrors.password} />
      {error && <Callout tone="danger">{error}</Callout>}
      <Button type="submit" variant="primary" className="h-10 w-full" loading={busy}>
        Sign in
      </Button>
    </form>
  );
}

/** Simple sign-in (SIMPLE_SIGNIN): full name and FR ID, no password */
function SimpleForm({ from }: { from: string }) {
  const { adopt } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; employeeCode?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = SimpleSignInSchema.safeParse({ name, employeeCode });
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors;
      setFieldErrors({ name: f.name?.[0], employeeCode: f.employeeCode?.[0] });
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      adopt((await api.post<SessionUser>("/api/auth/simple", parsed.data)).data);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <TextField label="Full name" autoComplete="name" autoFocus placeholder="Priya Menon" className="h-10" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors.name} />
      <TextField label="FR ID" autoComplete="username" placeholder="FR-0042" className="h-10" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} error={fieldErrors.employeeCode} hint="Your Focus Realm employee ID." />
      {error && <Callout tone="danger">{error}</Callout>}
      <Button type="submit" variant="primary" className="h-10 w-full" loading={busy}>
        Sign in
      </Button>
    </form>
  );
}

export function LoginPage() {
  useTitle("Sign in");
  const { status } = useAuth();
  const mode = useAuthMode();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [founderForm, setFounderForm] = useState(false);

  if (status === "authenticated") return <Navigate to={from} replace />;
  if (mode.isPending) return <FocusRealmLoader status="Checking how to sign in…" />;

  if (mode.data?.simple) {
    return (
      <AuthLayout
        title="Sign in"
        description="Enter your full name and your FR ID."
        footer="Every sign-in and action is recorded with your name and FR ID. Use your own."
      >
        <SimpleForm from={from} />
      </AuthLayout>
    );
  }

  // Hub mode: people sign in to the Focus Realm Workspace, which opens Mail Merge for them
  if (mode.data?.hub && mode.data.hubUrl) {
    return (
      <AuthLayout
        title="Sign in"
        description="Mail Merge is part of the Focus Realm Workspace. Sign in there with your employee ID and password."
        footer="Forgot your password? Reset it from the Workspace sign-in page, or ask a founder."
      >
        <div className="space-y-5">
          <a href={hubLinks(mode.data.hubUrl).signIn} className={buttonClasses("primary", "md", "h-10 w-full")}>
            Sign in with Focus Realm
          </a>
          {mode.data.passwordLogin &&
            (founderForm ? (
              <div className="space-y-4 border-t border-line pt-5">
                <p className="text-[13px] text-ink-subtle">Founder password sign-in, for when the Workspace is unavailable.</p>
                <PasswordForm from={from} />
              </div>
            ) : (
              <button type="button" onClick={() => setFounderForm(true)} className="block w-full text-center text-xs text-ink-subtle underline-offset-2 hover:text-ink hover:underline">
                Founder password sign-in
              </button>
            ))}
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back. Sign in with the email your founder invited."
      footer="Forgot your password? Ask a founder to send you a reset link."
    >
      <PasswordForm from={from} />
    </AuthLayout>
  );
}
