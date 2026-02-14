import { useEffect, useState } from "react";
import { ArrowLeft, FileText, Mail, Calendar, ChevronRight, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useLocale } from "../context/LocaleContext";
import { getMediaProtectionProps } from "../utils/mediaProtection";
import { openExternal } from "../utils/openExternal";

interface PolicySection {
  title: string;
  content: string[];
  warning?: boolean;
}

interface TermsData {
  lastUpdated: string;
  introduction: string;
  sections: PolicySection[];
  contact: {
    email: string;
    message: string;
  };
}

const defaultTermsData: TermsData = {
  lastUpdated: "2026-01-30",
  introduction:
    "Welcome to OTOSHI Launcher. These Terms of Service govern your use of our software and services. By accessing or using OTOSHI Launcher, you agree to be bound by these terms.",
  sections: [
    {
      title: "Acceptance of Terms",
      content: [
        "By downloading, installing, or using OTOSHI Launcher, you agree to these Terms of Service.",
        "If you do not agree to these terms, you must not use the software.",
        "We reserve the right to modify these terms at any time. Continued use after changes constitutes acceptance.",
      ],
    },
    {
      title: "Account Registration",
      content: [
        "You must create an account to access certain features of OTOSHI Launcher.",
        "You are responsible for maintaining the confidentiality of your account credentials.",
        "You must provide accurate and complete information when creating your account.",
        "You are responsible for all activities that occur under your account.",
      ],
    },
    {
      title: "Permitted Use",
      content: [
        "OTOSHI Launcher is provided for personal, non-commercial use only.",
        "You may download and install games through the launcher for your own use.",
        "You may use community features in accordance with our Community Guidelines.",
        "You may not reverse engineer, decompile, or modify the launcher software.",
      ],
    },
    {
      title: "Prohibited Activities",
      content: [
        "Sharing, selling, or distributing your account credentials.",
        "Using automated tools, bots, or scripts to interact with the launcher.",
        "Attempting to bypass security measures or access restricted areas.",
        "Uploading malicious content or engaging in harmful activities.",
        "Violating intellectual property rights of third parties.",
      ],
      warning: true,
    },
    {
      title: "Intellectual Property",
      content: [
        "OTOSHI Launcher and its original content are owned by OTOSHI and protected by copyright laws.",
        "Game content is owned by respective publishers and developers.",
        "Trademarks and logos are the property of their respective owners.",
        "You may not use our intellectual property without explicit permission.",
      ],
    },
    {
      title: "Purchases and Payments",
      content: [
        "All purchases are final unless otherwise stated.",
        "Prices are subject to change without notice.",
        "We use secure third-party payment processors.",
        "Refunds are subject to our Refund Policy.",
      ],
    },
    {
      title: "Termination",
      content: [
        "We may suspend or terminate your account for violations of these terms.",
        "You may delete your account at any time through account settings.",
        "Upon termination, your access to purchased content may be affected.",
        "Termination does not affect our right to pursue legal remedies.",
      ],
    },
    {
      title: "Limitation of Liability",
      content: [
        "OTOSHI Launcher is provided 'as is' without warranties of any kind.",
        "We are not liable for any indirect, incidental, or consequential damages.",
        "Our total liability is limited to the amount you paid for our services.",
        "Some jurisdictions do not allow limitation of liability, so this may not apply to you.",
      ],
    },
    {
      title: "Governing Law",
      content: [
        "These terms are governed by the laws of the applicable jurisdiction.",
        "Any disputes will be resolved through binding arbitration.",
        "You waive the right to participate in class action lawsuits.",
      ],
    },
  ],
  contact: {
    email: "legal@otoshi-launcher.me",
    message: "For legal inquiries or questions about these terms, contact us at",
  },
};

export default function TermsOfServicePage() {
  const { t } = useLocale();
  const [termsData, setTermsData] = useState<TermsData>(defaultTermsData);
  const [loading, setLoading] = useState(true);
  const [expandedSection, setExpandedSection] = useState<number | null>(null);

  useEffect(() => {
    const fetchTerms = async () => {
      try {
        // Try to fetch from Tauri command first (native/offline)
        const data = await invoke<TermsData>("get_terms_of_service");
        if (data) {
          setTermsData(data);
        }
      } catch (error) {
        // Fall back to API if available
        try {
          const response = await fetch("/api/policy/terms");
          if (response.ok) {
            const data = await response.json();
            setTermsData(data);
          }
        } catch {
          // Use default data
          console.log("Using default terms of service data");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchTerms();
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
              <div className="mx-auto mb-6 inline-flex items-center justify-center rounded-2xl bg-accent-blue/10 p-4">
                <FileText size={40} className="text-accent-blue" />
              </div>
              <h1 className="mb-4 text-4xl font-bold text-text-primary md:text-5xl">
                {t("policy.terms_title") || "Terms of Service"}
              </h1>
              <div className="flex items-center justify-center gap-2 text-text-muted">
                <Calendar size={16} />
                <span className="text-sm">
                  {t("policy.last_updated") || "Last updated"}: {termsData.lastUpdated}
                </span>
              </div>
            </div>

            {/* Introduction */}
            <div className="mb-12 rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-8 backdrop-blur-sm">
              <p className="text-lg leading-relaxed text-text-secondary">
                {termsData.introduction}
              </p>
            </div>

            {/* Terms Sections */}
            <div className="space-y-4">
              {termsData.sections.map((section, index) => (
                <div
                  key={index}
                  className={`overflow-hidden rounded-2xl border backdrop-blur-sm transition-all duration-300 ${
                    section.warning
                      ? "border-accent-orange/30 bg-gradient-to-br from-accent-orange/10 to-transparent hover:border-accent-orange/50"
                      : "border-white/10 bg-gradient-to-br from-white/5 to-transparent hover:border-accent-blue/30"
                  }`}
                >
                  <button
                    onClick={() => toggleSection(index)}
                    className="flex w-full items-center justify-between p-6 text-left transition"
                  >
                    <div className="flex items-center gap-3">
                      {section.warning && (
                        <AlertTriangle size={20} className="text-accent-orange" />
                      )}
                      <h2 className="text-lg font-bold text-text-primary">{section.title}</h2>
                    </div>
                    <ChevronRight
                      size={20}
                      className={`text-text-muted transition-transform duration-300 ${
                        expandedSection === index ? "rotate-90" : ""
                      }`}
                    />
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ${
                      expandedSection === index ? "max-h-[500px] pb-6" : "max-h-0"
                    }`}
                  >
                    <ul className="space-y-3 px-6">
                      {section.content.map((item, itemIndex) => (
                        <li
                          key={itemIndex}
                          className="flex items-start gap-3 text-text-secondary"
                        >
                          <span
                            className={`mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                              section.warning ? "bg-accent-orange" : "bg-accent-blue"
                            }`}
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>

            {/* Important Notice */}
            <div className="mt-12 rounded-2xl border border-accent-orange/30 bg-gradient-to-br from-accent-orange/10 to-transparent p-8 backdrop-blur-sm">
              <div className="flex items-start gap-4">
                <AlertTriangle size={24} className="flex-shrink-0 text-accent-orange" />
                <div>
                  <h3 className="mb-2 font-bold text-text-primary">
                    {t("policy.important_notice") || "Important Notice"}
                  </h3>
                  <p className="text-text-secondary">
                    {t("policy.terms_notice") ||
                      "By using OTOSHI Launcher, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service. If you do not agree to these terms, please discontinue use of the software immediately."}
                  </p>
                </div>
              </div>
            </div>

            {/* Contact Section */}
            <div className="mt-12 rounded-2xl border border-accent-blue/30 bg-gradient-to-br from-accent-blue/10 to-transparent p-8 text-center backdrop-blur-sm">
              <Mail size={32} className="mx-auto mb-4 text-accent-blue" />
              <p className="mb-4 text-text-secondary">{termsData.contact.message}</p>
              <a
                href={`mailto:${termsData.contact.email}`}
                className="inline-flex items-center gap-2 rounded-xl bg-accent-blue px-6 py-3 font-bold text-black transition hover:scale-105"
              >
                <Mail size={18} />
                {termsData.contact.email}
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
            <Link to="/privacy-policy" className="transition hover:text-text-primary">
              Privacy Policy
            </Link>
            <Link to="/terms-of-service" className="text-accent-blue transition hover:text-text-primary">
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
