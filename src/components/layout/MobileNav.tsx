import { NavLink } from "react-router-dom";
import { Store, Library, Download, Sparkles, User } from "lucide-react";
import { useLocale } from "../../context/LocaleContext";

const navItems = [
  { to: "/store", labelKey: "mobile_nav.game", icon: Store },
  { to: "/discover", labelKey: "mobile_nav.anime", icon: Sparkles },
  { to: "/library", labelKey: "mobile_nav.library", icon: Library },
  { to: "/downloads", labelKey: "mobile_nav.downloads", icon: Download },
  { to: "/profile", labelKey: "mobile_nav.profile", icon: User }
];

export default function MobileNav() {
  const { t } = useLocale();
  return (
    <nav className="fixed bottom-4 left-1/2 z-30 flex w-[92%] -translate-x-1/2 justify-between rounded-lg border border-background-border bg-background-elevated px-4 py-3 lg:hidden">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                isActive ? "text-primary" : "text-text-muted"
              }`
            }
          >
            <Icon size={16} />
            {t(item.labelKey)}
          </NavLink>
        );
      })}
    </nav>
  );
}
