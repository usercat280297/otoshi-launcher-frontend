import { Outlet, Link } from "react-router-dom";

export default function AuthLayout() {
  return (
    <div className="min-h-screen bg-background px-6 py-12">
      <div className="mx-auto mb-10 flex max-w-5xl items-center justify-between">
        <Link to="/store" className="text-sm font-semibold text-text-secondary">
          Back to store
        </Link>
        <div className="flex items-center gap-3">
          <img
            src="/OTOSHI_icon.png"
            alt="Otoshi"
            className="h-8 w-8 rounded-md bg-background-elevated p-1 object-contain"
          />
          <span className="text-xs uppercase tracking-[0.35em] text-text-muted">
            Otoshi Launcher
          </span>
        </div>
      </div>
      <Outlet />
    </div>
  );
}
