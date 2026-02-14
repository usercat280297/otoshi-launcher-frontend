import { useEffect, useState } from "react";
import { ArrowLeft, Shield, Mail, Calendar, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useLocale } from "../context/LocaleContext";
import { getMediaProtectionProps } from "../utils/mediaProtection";
import { openExternal } from "../utils/openExternal";

interface PolicySection {
  title: string;
  content: string[];
}

interface PolicyData {
  lastUpdated: string;
  introduction: string;
  sections: PolicySection[];
  contact: {
    email: string;
    message: string;
  };
}

const defaultPolicyData: PolicyData = {
  lastUpdated: "2026-01-30",
  introduction:
    "OTOSHI Launcher values your privacy. This policy explains what data we collect, how we use it, and the choices you have. By using OTOSHI Launcher, you agree to the practices described below.",
  sections: [
    {
      title: "Information we collect",
      content: [
        "Account data: email, username, display name, and login tokens.",
        "Device data: operating system, device identifiers, and app version.",
        "Usage data: library activity, download history, and feature usage.",
        "Community data: messages, reviews, and profile details you provide.",
      ],
    },
    {
      title: "How we use your information",
      content: [
        "Provide and improve launcher services, downloads, and updates.",
        "Secure accounts and prevent fraud or abuse.",
        "Analyze performance and optimize user experience.",
        "Support community and social features you enable.",
      ],
    },
    {
      title: "Sharing and disclosure",
      content: [
        "We do not sell your personal data.",
        "We may share limited data with service providers that help us operate the launcher (hosting, analytics, payment processing).",
        "We may also disclose information if required by law or to protect users and the platform.",
      ],
    },
    {
      title: "Data retention",
      content: [
        "We retain data only as long as needed to provide services or comply with legal obligations.",
        "You may request deletion of your account and related data at any time.",
      ],
    },
    {
      title: "Security",
      content: [
        "We use industry-standard safeguards to protect your data.",
        "No system is completely secure, but we continuously work to improve our protections.",
        "All data transmissions are encrypted using TLS 1.3.",
      ],
    },
    {
      title: "Children",
      content: [
        "OTOSHI Launcher is not intended for children under the age of 13.",
        "If you believe a child has provided personal information, contact us to remove it.",
      ],
    },
  ],
  contact: {
    email: "support@otoshi-launcher.me",
    message: "Questions about this policy? Contact us at",
  },
};

export default function PrivacyPolicyPage() {
  const { t } = useLocale();
  const [policyData, setPolicyData] = useState<PolicyData>(defaultPolicyData);
  const [loading, setLoading] = useState(true);
  const [expandedSection, setExpandedSection] = useState<number | null>(null);

  useEffect(() => {
    const fetchPolicy = async () => {
      try {
        // Try to fetch from Tauri command first (native/offline)
        const data = await invoke<PolicyData>("get_privacy_policy");
        if (data) {
          setPolicyData(data);
        }
      } catch (error) {
        // Fall back to API if available
        try {
          const response = await fetch("/api/policy/privacy");
          if (response.ok) {
            const data = await response.json();
            setPolicyData(data);
          }
        } catch {
          // Use default data
          console.log("Using default privacy policy data");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchPolicy();
  }, []);

  const toggleSection = (index: number) => {
    setExpandedSection(expandedSection === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background-base via-background-elevated to-background-base">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-background-base/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link
            to="/download-launcher"
            className="flex items-center gap-2 text-text-muted transition hover:text-text-primary"
          >
            <ArrowLeft size={20} />
            <span className="text-sm font-medium">{t("common.back") || "Back"}</span>
          </Link>
          <div className="flex items-center gap-3">
            <img
              src="/OTOSHI_icon.png"
              alt="Otoshi"
              className="h-8 w-8"
              {...getMediaProtectionProps()}
            />
            <span className="font-bold text-text-primary">OTOSHI</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-4xl px-6 py-12">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <>
            {/* Hero Section */}
            <div className="mb-12 text-center">
              <div className="mx-auto mb-6 inline-flex items-center justify-center rounded-2xl bg-primary/10 p-4">
                <Shield size={40} className="text-primary" />
              </div>
              <h1 className="mb-4 text-4xl font-bold text-text-primary md:text-5xl">
                {t("policy.privacy_title") || "Privacy Policy"}
              </h1>
              <div className="flex items-center justify-center gap-2 text-text-muted">
                <Calendar size={16} />
                <span className="text-sm">
                  {t("policy.last_updated") || "Last updated"}: {policyData.lastUpdated}
                </span>
              </div>
            </div>

            {/* Introduction */}
            <div className="mb-12 rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-8 backdrop-blur-sm">
              <p className="text-lg leading-relaxed text-text-secondary">
                {policyData.introduction}
              </p>
            </div>

            {/* Policy Sections */}
            <div className="space-y-4">
              {policyData.sections.map((section, index) => (
                <div
                  key={index}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-sm transition-all duration-300 hover:border-primary/30"
                >
                  <button
                    onClick={() => toggleSection(index)}
                    className="flex w-full items-center justify-between p-6 text-left transition"
                  >
                    <h2 className="text-lg font-bold text-text-primary">{section.title}</h2>
                    <ChevronRight
                      size={20}
                      className={`text-text-muted transition-transform duration-300 ${
                        expandedSection === index ? "rotate-90" : ""
                      }`}
                    />
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ${
                      expandedSection === index ? "max-h-96 pb-6" : "max-h-0"
                    }`}
                  >
                    <ul className="space-y-3 px-6">
                      {section.content.map((item, itemIndex) => (
                        <li
                          key={itemIndex}
                          className="flex items-start gap-3 text-text-secondary"
                        >
                          <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>

            {/* Contact Section */}
            <div className="mt-12 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-8 text-center backdrop-blur-sm">
              <Mail size={32} className="mx-auto mb-4 text-primary" />
              <p className="mb-4 text-text-secondary">{policyData.contact.message}</p>
              <a
                href={`mailto:${policyData.contact.email}`}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-bold text-black transition hover:scale-105"
              >
                <Mail size={18} />
                {policyData.contact.email}
              </a>
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 px-6 py-8">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-4 text-center md:flex-row md:text-left">
          <div className="flex items-center gap-3">
            <img
              src="/OTOSHI_icon.png"
              alt="Otoshi"
              className="h-6 w-6"
              {...getMediaProtectionProps()}
            />
            <span className="text-sm text-text-muted">
              © 2026 Otoshi Launcher. All rights reserved.
            </span>
          </div>
          <div className="flex items-center gap-6 text-sm text-text-muted">
            <Link to="/privacy-policy" className="text-primary transition hover:text-text-primary">
              Privacy Policy
            </Link>
            <Link to="/terms-of-service" className="transition hover:text-text-primary">
              Terms of Service
            </Link>
            <button
              type="button"
              onClick={() => void openExternal("https://discord.gg/6q7YRdWGZJ")}
              className="transition hover:text-text-primary"
            >
              Discord
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
