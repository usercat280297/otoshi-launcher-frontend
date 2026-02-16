import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { isTauri as isTauriRuntimeFn } from "@tauri-apps/api/core";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import MobileNav from "./MobileNav";
import Modal from "../common/Modal";
import { useLocale } from "../../context/LocaleContext";

export default function MainLayout() {
  const { t } = useLocale();
  const [luaMissing, setLuaMissing] = useState(false);
  const isTauriRuntime = (() => {
    try {
      return isTauriRuntimeFn();
    } catch {
      return false;
    }
  })();

  useEffect(() => {
    const handleMissing = () => setLuaMissing(true);
    const handleLoaded = () => setLuaMissing(false);
    window.addEventListener("otoshi:lua-games-missing", handleMissing as EventListener);
    window.addEventListener("otoshi:lua-games-loaded", handleLoaded as EventListener);
    return () => {
      window.removeEventListener("otoshi:lua-games-missing", handleMissing as EventListener);
      window.removeEventListener("otoshi:lua-games-loaded", handleLoaded as EventListener);
    };
  }, []);

  return (
    <div
      className={
        isTauriRuntime
          ? "h-[100dvh] w-screen overflow-hidden bg-background text-text-primary"
          : "min-h-screen w-screen overflow-x-hidden bg-background text-text-primary"
      }
    >
      <div className={isTauriRuntime ? "flex h-full min-h-0 w-full" : "flex min-h-screen w-full"}>
        <Sidebar />
        <div
          className={
            isTauriRuntime
              ? "relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background lg:ml-64"
              : "relative z-0 flex min-w-0 flex-1 flex-col bg-background lg:ml-64"
          }
        >
          <TopBar />
          <main
            className={
              isTauriRuntime
                ? "min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-elegant"
                : "flex-1 overflow-x-hidden"
            }
          >
            <div className="mx-auto w-full max-w-[1400px] px-4 pb-24 pt-4 sm:px-6 md:px-10 md:pb-12 md:pt-6">
              <Outlet />
            </div>
          </main>
          <MobileNav />
        </div>
      </div>
      <Modal
        isOpen={luaMissing}
        onClose={() => setLuaMissing(false)}
        title={t("lua.error.title")}
        size="sm"
      >
        <div className="space-y-4 text-sm text-text-secondary">
          <p>{t("lua.error.body")}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              className="epic-button-secondary px-4 py-2 text-xs"
              onClick={() => window.location.reload()}
            >
              {t("lua.error.retry")}
            </button>
            <button
              className="epic-button-secondary px-4 py-2 text-xs"
              onClick={() => setLuaMissing(false)}
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
