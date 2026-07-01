import { Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense } from "react";

const DownloadLauncherPage = lazy(() => import("./pages/DownloadLauncherPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const TermsOfServicePage = lazy(() => import("./pages/TermsOfServicePage"));
const IntroPage = lazy(() => import("./pages/IntroPage"));

export default function App() {
  return (
    <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center bg-black text-sm text-white/50">Loading...</div>}>
      <Routes>
        <Route path="/" element={<IntroPage />} />
        <Route path="/download-launcher" element={<DownloadLauncherPage />} />
        <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
        <Route path="/terms-of-service" element={<TermsOfServicePage />} />
        <Route path="*" element={<Navigate to="/download-launcher" replace />} />
      </Routes>
    </Suspense>
  );
}
