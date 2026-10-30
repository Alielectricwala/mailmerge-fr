import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { Button } from "../../components/ui/Button";
import { PasswordField, TextField } from "../../components/ui/Field";
import { FocusRealmLoader } from "../../components/brand/FocusRealmLoader";
import { Callout } from "../../components/ui/Feedback";
import { useAuth } from "../../lib/auth";
import { errorMessage } from "../../lib/api";
import { useTitle } from "../../lib/hooks";
import { LoginSchema } from "@shared/auth";

export function LoginPage() {
  useTitle("Sign in");
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entering, setEntering] = useState(false);

  if (entering) return <FocusRealmLoader status="Opening your workspace…" />;
  if (status === "authenticated") return <Navigate to={from} replace />;

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
    <AuthLayout
      title="Sign in"
      description="Welcome back. Sign in with the email your founder invited."
      footer="Forgot your password? Ask a founder to send you a reset link."
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <TextField label="Email" type="email" autoComplete="email" autoFocus placeholder="name@company.com" className="h-10" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email} />
        <PasswordField label="Password" autoComplete="current-password" className="h-10" value={password} onChange={(e) => setPassword(e.target.value)} error={fieldErrors.password} />
        {error && <Callout tone="danger">{error}</Callout>}
        <Button type="submit" variant="primary" className="h-10 w-full" loading={busy}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
