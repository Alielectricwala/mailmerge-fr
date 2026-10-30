// Accept an invite, or reset a password, from a single-use link
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { Button } from "../../components/ui/Button";
import { PasswordField, TextField } from "../../components/ui/Field";
import { Callout } from "../../components/ui/Feedback";
import { Spinner } from "../../components/ui/Spinner";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useTitle } from "../../lib/hooks";
import { ROLE_LABELS, PASSWORD_MIN_LENGTH, type UserRole } from "@shared/auth";

function PasswordFields({ password, setPassword, confirm, setConfirm, errors }: { password: string; setPassword: (v: string) => void; confirm: string; setConfirm: (v: string) => void; errors: { password?: string; confirm?: string } }) {
  return (
    <>
      <PasswordField label="New password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase works well.`} />
      <PasswordField label="Confirm password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
    </>
  );
}

function checkPasswords(password: string, confirm: string) {
  const errors: { password?: string; confirm?: string } = {};
  if (password.length < PASSWORD_MIN_LENGTH) errors.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  else if (password !== confirm) errors.confirm = "The passwords don't match.";
  return errors;
}

export function AcceptInvitePage() {
  useTitle("Join the team");
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api.get<{ email: string; name: string; role: UserRole }>(`/api/auth/invite/${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
  });
  const [name, setName] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; name?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token || invite.isError) {
    return (
      <AuthLayout title="Invite link not valid" footer={<Link to="/login" className="link">Go to sign in</Link>}>
        <Callout tone="warning">{invite.error ? errorMessage(invite.error) : "This link is missing its token. Open the full link from your invite email."}</Callout>
      </AuthLayout>
    );
  }
  if (invite.isPending) {
    return (
      <AuthLayout title="Checking your invite">
        <div className="flex justify-center py-6"><Spinner /></div>
      </AuthLayout>
    );
  }

  const data = invite.data.data;
  const currentName = name ?? data.name;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = { ...checkPasswords(password, confirm), ...(currentName.trim() ? {} : { name: "Enter your name." }) };
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/accept-invite", { token, name: currentName, password });
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Join FocusRealm Mail Merge" description={<>You're joining as <strong className="text-ink">{ROLE_LABELS[data.role].toLowerCase()}</strong> with {data.email}.</>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextField label="Your name" value={currentName} onChange={(e) => setName(e.target.value)} error={errors.name} autoComplete="name" />
        <PasswordFields password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} errors={errors} />
        {error && <Callout tone="danger">{error}</Callout>}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  useTitle("Reset password");
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = checkPasswords(password, confirm);
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/reset-password", { token, password });
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Choose a new password" description="This link works once. You'll be signed in afterwards." footer={<Link to="/login" className="link">Back to sign in</Link>}>
      {!token ? (
        <Callout tone="warning">This link is missing its token. Open the full link you were sent.</Callout>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <PasswordFields password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} errors={errors} />
          {error && <Callout tone="danger">{error}</Callout>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Save password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
