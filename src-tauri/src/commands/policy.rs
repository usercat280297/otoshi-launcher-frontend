use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicySection {
    pub title: String,
    pub content: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyContact {
    pub email: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyPolicyData {
    pub last_updated: String,
    pub introduction: String,
    pub sections: Vec<PolicySection>,
    pub contact: PolicyContact,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermsOfServiceData {
    pub last_updated: String,
    pub introduction: String,
    pub sections: Vec<PolicySection>,
    pub contact: PolicyContact,
}

/// Get the privacy policy data
#[tauri::command]
pub async fn get_privacy_policy() -> Result<PrivacyPolicyData, String> {
    Ok(PrivacyPolicyData {
        last_updated: "2026-01-30".to_string(),
        introduction: "OTOSHI Launcher values your privacy. This policy explains what data we collect, how we use it, and the choices you have. By using OTOSHI Launcher, you agree to the practices described below.".to_string(),
        sections: vec![
            PolicySection {
                title: "Information we collect".to_string(),
                content: vec![
                    "Account data: email, username, display name, and login tokens.".to_string(),
                    "Device data: operating system, device identifiers, and app version.".to_string(),
                    "Usage data: library activity, download history, and feature usage.".to_string(),
                    "Community data: messages, reviews, and profile details you provide.".to_string(),
                ],
                warning: None,
            },
            PolicySection {
                title: "How we use your information".to_string(),
                content: vec![
                    "Provide and improve launcher services, downloads, and updates.".to_string(),
                    "Secure accounts and prevent fraud or abuse.".to_string(),
                    "Analyze performance and optimize user experience.".to_string(),
                    "Support community and social features you enable.".to_string(),
                ],
                warning: None,
            },
            PolicySection {
                title: "Sharing and disclosure".to_string(),
                content: vec![
                    "We do not sell your personal data.".to_string(),
                    "We may share limited data with service providers that help us operate the launcher (hosting, analytics, payment processing).".to_string(),
                    "We may also disclose information if required by law or to protect users and the platform.".to_string(),
                ],
                warning: None,
            },
            PolicySection {
                title: "Data retention".to_string(),
                content: vec![
                    "We retain data only as long as needed to provide services or comply with legal obligations.".to_string(),
                    "You may request deletion of your account and related data at any time.".to_string(),
                ],
                warning: None,
            },
            PolicySection {
                title: "Security".to_string(),
                content: vec![
                    "We use industry-standard safeguards to protect your data.".to_string(),
                    "No system is completely secure, but we continuously work to improve our protections.".to_string(),
                    "All data transmissions are encrypted using TLS 1.3.".to_string(),
                ],
                warning: None,
            },
            PolicySection {
                title: "Children".to_string(),
                content: vec![
                    "OTOSHI Launcher is not intended for children under the age of 13.".to_string(),
                    "If you believe a child has provided personal information, contact us to remove it.".to_string(),
                ],
                warning: None,
            },
        ],
        contact: PolicyContact {
            email: "support@otoshi-launcher.me".to_string(),
            message: "Questions about this policy? Contact us at".to_string(),
        },
    })
}

/// Get the terms of service data
#[tauri::command]
pub async fn get_terms_of_service() -> Result<TermsOfServiceData, String> {
    Ok(TermsOfServiceData {
        last_updated: "2026-01-30".to_string(),
        introduction: "Welcome to OTOSHI Launcher. These Terms of Service govern your use of our software and services. By accessing or using OTOSHI Launcher, you agree to be bound by these terms.".to_string(),
        sections: vec![
            PolicySection {
                title: "Acceptance of Terms".to_string(),
                content: vec![
                    "By downloading, installing, or using OTOSHI Launcher, you agree to these Terms of Service.".to_string(),
                    "If you do not agree to these terms, you must not use the software.".to_string(),
                    "We reserve the right to modify these terms at any time. Continued use after changes constitutes acceptance.".to_string(),
                ],
                warning: None,
            },
            PolicySection {
                title: "Account Registration".to_string(),
                content: vec![
                    "You must create an account to access certain features of OTOSHI Launcher.".to_string(),
                    "You are responsible for maintaining the confidentiality of your account credentials.".to_string(),
                    "You must provide accurate and complete information when creating your account.".to_string(),
                    "You are responsible for all activities that occur under your account.".to_string(),
                ],
                warning: None,
            },
            PolicySection {
                title: "Permitted Use".to_string(),
                content: vec![
                    "OTOSHI Launcher is provided for personal, non-commercial use only.".to_string(),
                    "You may download and install games through the launcher for your own use.".to_string(),
                    "You may use community features in accordance with our Community Guidelines.".to_string(),
                    "You may not reverse engineer, decompile, or modify the launcher software.".to_string(),
                ],
                warning: None,
            },
            PolicySection {
                title: "Prohibited Activities".to_string(),
                content: vec![
                    "Sharing, selling, or distributing your account credentials.".to_string(),
                    "Using automated tools, bots, or scripts to interact with the launcher.".to_string(),
                    "Attempting to bypass security measures or access restricted areas.".to_string(),
                    "Uploading malicious content or engaging in harmful activities.".to_string(),
                    "Violating intellectual property rights of third parties.".to_string(),
                ],
                warning: Some(true),
            },
            PolicySection {
                title: "Intellectual Property".to_string(),
                content: vec![
                    "OTOSHI Launcher and its original content are owned by OTOSHI and protected by copyright laws.".to_string(),
                    "Game content is owned by respective publishers and developers.".to_string(),
                    "Trademarks and logos are the property of their respective owners.".to_string(),
                    "You may not use our intellectual property without explicit permission.".to_string(),
                ],
                warning: None,
            },
            PolicySection {
                title: "Purchases and Payments".to_string(),
                content: vec![
                    "All purchases are final unless otherwise stated.".to_string(),
                    "Prices are subject to change without notice.".to_string(),
                    "We use secure third-party payment processors.".to_string(),
                    "Refunds are subject to our Refund Policy.".to_string(),
                ],
                warning: None,
            },
            PolicySection {
                title: "Termination".to_string(),
                content: vec![
                    "We may suspend or terminate your account for violations of these terms.".to_string(),
                    "You may delete your account at any time through account settings.".to_string(),
                    "Upon termination, your access to purchased content may be affected.".to_string(),
                    "Termination does not affect our right to pursue legal remedies.".to_string(),
                ],
                warning: None,
            },
            PolicySection {
                title: "Limitation of Liability".to_string(),
                content: vec![
                    "OTOSHI Launcher is provided 'as is' without warranties of any kind.".to_string(),
                    "We are not liable for any indirect, incidental, or consequential damages.".to_string(),
                    "Our total liability is limited to the amount you paid for our services.".to_string(),
                    "Some jurisdictions do not allow limitation of liability, so this may not apply to you.".to_string(),
                ],
                warning: None,
            },
            PolicySection {
                title: "Governing Law".to_string(),
                content: vec![
                    "These terms are governed by the laws of the applicable jurisdiction.".to_string(),
                    "Any disputes will be resolved through binding arbitration.".to_string(),
                    "You waive the right to participate in class action lawsuits.".to_string(),
                ],
                warning: None,
            },
        ],
        contact: PolicyContact {
            email: "legal@otoshi-launcher.me".to_string(),
            message: "For legal inquiries or questions about these terms, contact us at".to_string(),
        },
    })
}
