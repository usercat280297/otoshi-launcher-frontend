import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";

export default function OAuthCallbackPage() {
  const { exchangeOAuth } = useAuth();
  const { t } = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const next = params.get("next") || "/store";
    if (!code) {
      setError(t("auth.oauth_missing_code"));
      return;
    }

    exchangeOAuth(code)
      .then(() => navigate(next, { replace: true }))
      .catch((err: any) =>
        setError(err?.message || t("auth.oauth_unable_complete_sign_in"))
      );
  }, [exchangeOAuth, location.search, navigate, t]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold">{t("auth.oauth_signing_you_in")}</h1>
        <p className="text-text-secondary">
          {t("auth.oauth_finishing_connection")}
        </p>
      </div>
      <div className="glass-panel space-y-3 p-6">
        {!error ? (
          <p className="text-sm text-text-secondary">{t("auth.oauth_connecting")}</p>
        ) : (
          <p className="text-sm text-accent-red">{error}</p>
        )}
      </div>
    </div>
  );
}
