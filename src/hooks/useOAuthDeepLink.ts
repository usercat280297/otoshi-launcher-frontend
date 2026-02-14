import { useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { isTauri } from "@tauri-apps/api/core";
import { useAuth } from "../context/AuthContext";

/**
 * Hook to listen for OAuth deep-link callbacks in Tauri app.
 * When a deep-link like otoshi://oauth/callback?code=xxx&next=/store is received,
 * it will exchange the code for tokens and navigate to the next path.
 */
export function useOAuthDeepLink() {
  const navigate = useNavigate();
  const { exchangeOAuth } = useAuth();
  const isProcessing = useRef(false);

  const handleOAuthCallback = useCallback(async (urlStr: string) => {
    if (isProcessing.current) return;
    isProcessing.current = true;

    try {
      console.log("[OAuth Deep Link] Received URL:", urlStr);
      
      // Parse the URL - handle both otoshi://oauth/callback and otoshi://callback
      let url: URL;
      try {
        // Replace custom protocol with http for URL parsing
        const httpUrl = urlStr.replace(/^otoshi:\/\//, "http://otoshi.local/");
        url = new URL(httpUrl);
      } catch {
        console.error("[OAuth Deep Link] Failed to parse URL:", urlStr);
        return;
      }

      const code = url.searchParams.get("code");
      const next = url.searchParams.get("next") || "/store";
      const provider = url.searchParams.get("provider");

      console.log("[OAuth Deep Link] Parsed:", { code: code?.slice(0, 10) + "...", next, provider });

      if (!code) {
        console.error("[OAuth Deep Link] Missing code parameter");
        navigate("/login?error=missing_code", { replace: true });
        return;
      }

      // Exchange the code for tokens
      await exchangeOAuth(code);
      console.log("[OAuth Deep Link] Token exchange successful, navigating to:", next);
      navigate(next, { replace: true });
    } catch (error: any) {
      console.error("[OAuth Deep Link] Error:", error);
      navigate(`/login?error=${encodeURIComponent(error?.message || "oauth_failed")}`, { replace: true });
    } finally {
      isProcessing.current = false;
    }
  }, [exchangeOAuth, navigate]);

  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        
        // Listen for oauth-callback events from Rust backend
        const unlistenFn = await listen<string>("oauth-callback", (event) => {
          console.log("[OAuth Deep Link] Event received:", event.payload);
          handleOAuthCallback(event.payload);
        });
        
        unlisten = unlistenFn;
        console.log("[OAuth Deep Link] Listener registered");
      } catch (error) {
        console.error("[OAuth Deep Link] Failed to setup listener:", error);
      }
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
        console.log("[OAuth Deep Link] Listener removed");
      }
    };
  }, [handleOAuthCallback]);
}

/**
 * Check if we're running in Tauri environment
 */
export function useTauriCheck(): boolean {
  return isTauri();
}
