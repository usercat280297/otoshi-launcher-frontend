/** @type {import("tailwindcss").Config} */
const withOpacity = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: withOpacity("--color-bg"),
          base: withOpacity("--color-bg"),
          elevated: withOpacity("--color-bg-elevated"),
          surface: withOpacity("--color-bg-surface"),
          muted: withOpacity("--color-bg-muted"),
          border: withOpacity("--color-bg-border")
        },
        primary: {
          DEFAULT: withOpacity("--color-primary"),
          hover: withOpacity("--color-primary-hover"),
          deep: withOpacity("--color-primary-deep")
        },
        accent: {
          red: withOpacity("--color-accent-red"),
          redSoft: withOpacity("--color-accent-red-soft"),
          green: withOpacity("--color-accent-green"),
          blue: withOpacity("--color-accent-blue"),
          orange: withOpacity("--color-accent-orange"),
          amber: withOpacity("--color-accent-amber")
        },
        success: withOpacity("--color-success"),
        warning: withOpacity("--color-warning"),
        text: {
          primary: withOpacity("--color-text-primary"),
          secondary: withOpacity("--color-text-secondary"),
          muted: withOpacity("--color-text-muted")
        }
      },
      fontFamily: {
        display: ["\"Inter Tight\"", "\"Inter\"", "system-ui", "sans-serif"],
        body: ["\"Inter\"", "system-ui", "sans-serif"],
        mono: ["\"Recursive\"", "ui-monospace", "monospace"]
      },
      boxShadow: {
        panel: "0 18px 40px rgba(0, 0, 0, 0.35)",
        soft: "0 8px 18px rgba(0, 0, 0, 0.35)"
      },
      backgroundImage: {
        "hero-glow": "radial-gradient(circle at 12% 30%, rgba(38, 187, 255, 0.2), transparent 55%), radial-gradient(circle at 70% 10%, rgba(255, 63, 86, 0.18), transparent 45%)"
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: 0, transform: "translateY(10px)" },
          "100%": { opacity: 1, transform: "translateY(0)" }
        },
        "fade-in": {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 }
        },
        "float-slow": {
          "0%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
          "100%": { transform: "translateY(0)" }
        }
      },
      animation: {
        "fade-up": "fade-up 0.6s ease-out both",
        "fade-in": "fade-in 0.6s ease-out both",
        "float-slow": "float-slow 6s ease-in-out infinite"
      }
    }
  },
  plugins: []
};
