import { useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import OAuthButtons from "../components/auth/OAuthButtons";

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const from = (location.state as { from?: Location })?.from?.pathname || "/store";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message || t("auth.error.unable_sign_in"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold">{t("action.sign_in")}</h1>
        <p className="text-text-secondary">
          {t("auth.login_subtitle")}
        </p>
      </div>
      <div className="glass-panel space-y-6 p-6">
        <OAuthButtons nextPath={from} />
        <div className="flex items-center gap-4 text-xs uppercase tracking-[0.25em] text-text-muted">
          <span className="h-px flex-1 bg-background-border" />
          {t("auth.or_use_email")}
          <span className="h-px flex-1 bg-background-border" />
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email-input" className="text-xs uppercase tracking-[0.3em] text-text-muted">
              {t("auth.email")}
            </label>
            <input
              id="email-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full rounded-md border border-background-border bg-background-surface px-4 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label htmlFor="password-input" className="text-xs uppercase tracking-[0.3em] text-text-muted">
              {t("auth.password")}
            </label>
            <input
              id="password-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-md border border-background-border bg-background-surface px-4 py-2 text-sm"
              required
            />
          </div>
          {error && <p className="text-sm text-accent-red">{error}</p>}
          <button type="submit" className="epic-button w-full" disabled={loading}>
            {loading ? t("auth.signing_in") : t("action.sign_in")}
          </button>
          <p className="text-xs text-text-secondary">
            {t("auth.no_account")}{" "}
            <Link to="/register" className="text-primary hover:text-primary-hover">
              {t("auth.create_one")}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
