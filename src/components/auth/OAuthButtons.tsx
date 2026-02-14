import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";
import { buildOAuthStartUrl, fetchOAuthProviders, pollOAuthStatus } from "../../services/api";
import { open } from "@tauri-apps/plugin-shell";
import { isTauri } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";

interface OAuthButtonsProps {
  nextPath?: string;
}

export default function OAuthButtons({ nextPath = "/" }: OAuthButtonsProps) {
  const navigate = useNavigate();
  const { loading: authLoading, exchangeOAuth } = useAuth();
  const { t } = useLocale();
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerEnabled, setProviderEnabled] = useState<Record<string, boolean>>({});
  const pollTimerRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const activeProviderRef = useRef<string | null>(null);
  const pollingBusyRef = useRef(false);

  const clearPendingTimers = () => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearPendingTimers();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchOAuthProviders()
      .then((providers) => {
        if (!mounted) return;
        const enabledMap: Record<string, boolean> = {};
        for (const provider of providers) {
          enabledMap[provider.provider] = provider.enabled;
        }
        setProviderEnabled(enabledMap);
      })
      .catch(() => {
        // Keep defaults when endpoint is unavailable.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleLogin = async (provider: string) => {
    if (providerEnabled[provider] === false) {
      setError(`${t("auth.oauth_provider_not_configured")} "${provider}".`);
      return;
    }

    setLoadingProvider(provider);
    setError(null);
    activeProviderRef.current = provider;
    clearPendingTimers();

    try {
      const { url, requestId } = await buildOAuthStartUrl(provider, nextPath);

      if (isTauri()) {
        console.log("Opening external browser for OAuth...", url);
        try {
          await open(url);
        } catch (err) {
          console.error("Failed to open browser:", err);
        }

        const finishWithError = (message: string) => {
          clearPendingTimers();
          if (activeProviderRef.current === provider) {
            setLoadingProvider(null);
            setError(message);
          }
        };

        timeoutRef.current = window.setTimeout(() => {
          finishWithError(t("auth.oauth_login_timeout"));
        }, 300000);

        if (requestId) {
          pollTimerRef.current = window.setInterval(async () => {
            if (pollingBusyRef.current) return;
            pollingBusyRef.current = true;
            try {
              const result = await pollOAuthStatus(requestId);
              if (!result?.code) return;
              clearPendingTimers();
              await exchangeOAuth(result.code);
              if (activeProviderRef.current === provider) {
                setLoadingProvider(null);
              }
              activeProviderRef.current = null;
              navigate(nextPath || "/store", { replace: true });
            } catch (pollErr: any) {
              finishWithError(pollErr?.message || t("auth.oauth_unable_complete_sign_in"));
            } finally {
              pollingBusyRef.current = false;
            }
          }, 1000);
        }
      } else {
        window.location.href = url;
      }
    } catch (err: any) {
      console.error("OAuth error:", err);
      setError(err.message || t("auth.oauth_failed_start_login"));
      setLoadingProvider(null);
      activeProviderRef.current = null;
      clearPendingTimers();
    }
  };

  const providers = [
    {
      id: "google",
      name: "Google",
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="currentColor"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="currentColor"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z"
          />
          <path
            fill="currentColor"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
      ),
      bg: "hover:bg-red-500/10 hover:text-red-500",
      border: "hover:border-red-500/50"
    },
    {
      id: "steam",
      name: "Steam",
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M11.979 0C5.678 0 .511 4.86.022 10.94l6.432 2.658a3.387 3.387 0 0 1 1.912-.588c.064 0 .127.002.19.006l2.861-4.142V8.83a4.528 4.528 0 0 1 4.524-4.524 4.528 4.528 0 0 1 4.523 4.524 4.528 4.528 0 0 1-4.523 4.524h-.105l-4.076 2.911c0 .052.004.105.004.159a3.393 3.393 0 0 1-3.39 3.39 3.401 3.401 0 0 1-3.327-2.727L.258 14.07A12.006 12.006 0 0 0 11.979 24c6.628 0 12-5.372 12-12S18.607 0 11.979 0zM7.54 18.21l-1.473-.61a2.538 2.538 0 0 0 4.672.21 2.536 2.536 0 0 0-1.268-3.352 2.547 2.547 0 0 0-1.852-.107l1.523.63a1.87 1.87 0 1 1-1.602 3.229zm7.882-7.873a3.018 3.018 0 0 0 3.014-3.015 3.018 3.018 0 0 0-3.014-3.015 3.018 3.018 0 0 0-3.015 3.015 3.018 3.018 0 0 0 3.015 3.015zm-.001-5.276a2.265 2.265 0 0 1 2.263 2.261 2.265 2.265 0 0 1-2.263 2.263 2.265 2.265 0 0 1-2.262-2.263 2.265 2.265 0 0 1 2.262-2.261z"/>
        </svg>
      ),
      bg: "hover:bg-sky-500/10 hover:text-sky-500",
      border: "hover:border-sky-500/50"
    },
    {
      id: "epic",
      name: "Epic Games",
      icon: (
        <img
          src="/icons/epic-games-shield.svg"
          alt="Epic Games"
          className="w-5 h-5 object-contain"
          draggable={false}
        />
      ),
      bg: "hover:bg-blue-500/10 hover:text-blue-500",
      border: "hover:border-blue-500/50"
    },
    {
      id: "discord",
      name: "Discord",
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
        </svg>
      ),
      bg: "hover:bg-indigo-500/10 hover:text-indigo-500",
      border: "hover:border-indigo-500/50"
    }
  ];

  return (
    <div className="flex flex-col gap-3 w-full">
      {error && (
        <div className="text-red-500 text-xs text-center mb-2 bg-red-500/10 p-2 rounded">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => handleLogin(p.id)}
            disabled={!!loadingProvider || authLoading || providerEnabled[p.id] === false}
            className={`
              relative flex items-center justify-center gap-2 p-2.5 rounded-lg
              bg-[#1a1b1e] border border-white/5 transition-all duration-200
              ${p.bg} ${p.border} hover:border-opacity-100
              disabled:opacity-50 disabled:cursor-not-allowed
              group overflow-hidden
            `}
          >
            {loadingProvider === p.id ? (
              <Loader2 className="w-5 h-5 animate-spin text-white/50" />
            ) : (
              <>
                <div className={`transition-transform duration-200 group-hover:scale-110`}>
                  {p.icon}
                </div>
                <span className="text-sm font-medium text-white/70 group-hover:text-white">
                  {providerEnabled[p.id] === false ? `${p.name} (${t("auth.oauth_not_configured")})` : p.name}
                </span>
              </>
            )}
            
            {/* Hover Glow Effect */}
            <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/0 to-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>
      
      {loadingProvider && (
         <div className="text-xs text-center text-white/30 animate-pulse mt-1">
            {loadingProvider === 'google' || loadingProvider === 'discord' ? 
               t("auth.oauth_check_browser") : t("auth.oauth_connecting_short")}
         </div>
      )}
    </div>
  );
}
