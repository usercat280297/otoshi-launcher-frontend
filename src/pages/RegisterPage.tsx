import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import OAuthButtons from "../components/auth/OAuthButtons";

export default function RegisterPage() {
  const { register } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: "",
    username: "",
    display_name: "",
    password: ""
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(form);
      navigate("/store");
    } catch (err: any) {
      setError(err.message || t("auth.error.unable_create_account"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold">{t("auth.create_account")}</h1>
        <p className="text-text-secondary">
          {t("auth.register_subtitle")}
        </p>
      </div>
      <div className="glass-panel space-y-6 p-6">
        <OAuthButtons />
        <div className="flex items-center gap-4 text-xs uppercase tracking-[0.25em] text-text-muted">
          <span className="h-px flex-1 bg-background-border" />
          {t("auth.or_create_with_email")}
          <span className="h-px flex-1 bg-background-border" />
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="username-input" className="text-xs uppercase tracking-[0.3em] text-text-muted">
                {t("auth.username")}
              </label>
              <input
                id="username-input"
                value={form.username}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, username: event.target.value }))
                }
                className="mt-2 w-full rounded-md border border-background-border bg-background-surface px-4 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label htmlFor="displayname-input" className="text-xs uppercase tracking-[0.3em] text-text-muted">
                {t("auth.display_name")}
              </label>
              <input
                id="displayname-input"
                value={form.display_name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, display_name: event.target.value }))
                }
                className="mt-2 w-full rounded-md border border-background-border bg-background-surface px-4 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor="email-input-register" className="text-xs uppercase tracking-[0.3em] text-text-muted">
              {t("auth.email")}
            </label>
            <input
              id="email-input-register"
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, email: event.target.value }))
              }
              className="mt-2 w-full rounded-md border border-background-border bg-background-surface px-4 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label htmlFor="password-input-register" className="text-xs uppercase tracking-[0.3em] text-text-muted">
              {t("auth.password")}
            </label>
            <input
              id="password-input-register"
              type="password"
              value={form.password}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, password: event.target.value }))
              }
              className="mt-2 w-full rounded-md border border-background-border bg-background-surface px-4 py-2 text-sm"
              required
            />
          </div>
          {error && <p className="text-sm text-accent-red">{error}</p>}
          <button type="submit" className="epic-button w-full" disabled={loading}>
            {loading ? t("auth.creating_account") : t("auth.create_account")}
          </button>
          <p className="text-xs text-text-secondary">
            {t("auth.already_have_account")}{" "}
            <Link to="/login" className="text-primary hover:text-primary-hover">
              {t("action.sign_in")}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
