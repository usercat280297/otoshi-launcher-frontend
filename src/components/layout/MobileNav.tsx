import { NavLink } from "react-router-dom";
import { Store, Library, Download, Sparkles, User } from "lucide-react";

const navItems = [
  { to: "/store", label: "Game", icon: Store },
  { to: "/discover", label: "Anime", icon: Sparkles },
  { to: "/library", label: "Library", icon: Library },
  { to: "/downloads", label: "Downloads", icon: Download },
  { to: "/profile", label: "Profile", icon: User }
];

export default function MobileNav() {
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
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
