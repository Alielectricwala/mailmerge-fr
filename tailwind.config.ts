import type { Config } from "tailwindcss";

// Colors come from CSS variables in src/client/styles/tokens.css (single source of truth).
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./index.html", "./src/client/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: token("canvas"),
        surface: { DEFAULT: token("surface"), muted: token("surface-muted"), sunken: token("surface-sunken") },
        line: { DEFAULT: token("line"), strong: token("line-strong") },
        ink: { DEFAULT: token("ink"), muted: token("ink-muted"), subtle: token("ink-subtle"), faint: token("ink-faint") },
        brand: { DEFAULT: token("brand"), hover: token("brand-hover"), soft: token("brand-soft"), ink: token("brand-ink") },
        success: { DEFAULT: token("success"), soft: token("success-soft") },
        warning: { DEFAULT: token("warning"), soft: token("warning-soft") },
        danger: { DEFAULT: token("danger"), hover: token("danger-hover"), soft: token("danger-soft") },
        navy: token("navy"),
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        DEFAULT: "6px",
        md: "8px",
        lg: "10px",
        xl: "12px",
      },
      boxShadow: {
        xs: "0 1px 2px rgb(16 24 40 / 0.04)",
        card: "0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.03)",
        pop: "0 12px 32px -8px rgb(16 24 40 / 0.18), 0 4px 8px -4px rgb(16 24 40 / 0.08)",
        focus: "0 0 0 3px rgb(var(--brand) / 0.22)",
      },
      zIndex: { dropdown: "40", drawer: "50", modal: "60", toast: "70" },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "pop-in": { from: { opacity: "0", transform: "translateY(4px) scale(0.98)" }, to: { opacity: "1", transform: "none" } },
        "slide-in": { from: { transform: "translateX(16px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
        "loader-bar": { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(250%)" } },
        // Logo: brackets settle into focus, then the envelope flap re-seals
        "fr-focus": { "0%, 100%": { transform: "scale(1.12)", opacity: "0.45" }, "45%, 70%": { transform: "scale(1)", opacity: "1" } },
        "fr-seal": { "0%, 20%": { strokeDashoffset: "1" }, "55%, 100%": { strokeDashoffset: "0" } },
        "nav-progress": { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(100%)" } },
      },
      animation: {
        "fade-in": "fade-in 120ms ease-out",
        "pop-in": "pop-in 140ms ease-out",
        "slide-in": "slide-in 160ms ease-out",
        "loader-bar": "loader-bar 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "fr-focus": "fr-focus 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "fr-seal": "fr-seal 2.4s ease-in-out infinite",
        "nav-progress": "nav-progress 1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
