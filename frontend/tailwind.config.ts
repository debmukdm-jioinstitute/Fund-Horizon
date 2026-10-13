import type { Config } from "tailwindcss";

const googleSans = ["var(--font-google-sans)", "'Google Sans Variable'", "'Google Sans'", "sans-serif"];

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Raise the smallest text sizes: 12px was too small for dense tables and badges.
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1.2rem" }],
        sm: ["0.9375rem", { lineHeight: "1.4rem" }],
      },
      colors: {
        terminal: {
          bg: "var(--terminal-bg)",
          surface: "var(--terminal-surface)",
          primary: "var(--terminal-text-primary)",
          secondary: "var(--terminal-text-secondary)",
          border: "var(--terminal-border)",
          accent: "var(--terminal-accent)",
          accentBg: "var(--terminal-accent-bg)",
          positive: "var(--terminal-positive)",
          negative: "var(--terminal-negative)",
        },
        navy: {
          950: "#06172C",
          900: "#0B2545",
          850: "#0F2D54",
          800: "#13315C",
          700: "#1D4373",
          600: "#2B5A96",
          500: "#3E74B8",
          400: "#6593CD",
          300: "#96B7DE",
          200: "#BAD0EC",
          100: "#DCE6F2",
          50: "#F3F6FA",
        },
        // Backoffice neutrals/accents. These MUST stay defined: classes like `bg-forest-700 text-white` and
        // `text-sand-600` silently render nothing (white-on-white text) when the palette is missing.
        sand: {
          950: "#121210", 900: "#1F1E1B", 800: "#2F2E29", 700: "#46453D", 600: "#5C5A50", 500: "#6E6B5F",
          400: "#8A8676", 300: "#CFCBBD", 200: "#E3E0D6", 100: "#F0EEE8", 50: "#F8F7F4",
        },
        forest: {
          950: "#07211A", 900: "#0C3324", 800: "#114530", 700: "#17563A", 600: "#1F6B44", 500: "#2E8656",
          400: "#4DA373", 300: "#7DC19A", 200: "#AEDABF", 100: "#D6EDDF", 50: "#EEF7F1",
        },
        teal: { 700: "#0A6B64", 600: "#0E7C74", 500: "#13A89E", 400: "#17c4b8", 100: "#D6F1EE", 50: "#EEF8F7" },
        amber: { 600: "#B45309", 100: "#FEF3C7" },
        rose: { 700: "#B42318", 600: "#E11D48", 100: "#FEE4E2" },
      },
      // Google Sans is the ONLY typeface. Every font utility resolves to it so no class can pick another family.
      fontFamily: {
        sans: googleSans,
        display: googleSans,
        mono: googleSans,
        serif: googleSans,
      },

      boxShadow: {
        glass: "0 8px 32px 0 rgba(11, 37, 69, 0.06), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)",
        "glass-lg": "0 16px 40px -8px rgba(11, 37, 69, 0.08), inset 0 1px 0 0 rgba(255, 255, 255, 0.9)",
        "glass-hover": "0 20px 48px -10px rgba(19, 168, 158, 0.16), 0 12px 24px -6px rgba(11, 37, 69, 0.06), inset 0 1px 0 0 rgba(255, 255, 255, 1)",
        "3d": "0 4px 6px -1px rgba(15, 23, 42, 0.04), 0 10px 15px -3px rgba(15, 23, 42, 0.06), inset 0 1px 0 0 rgba(255, 255, 255, 0.95), inset 0 -2px 0 0 rgba(15, 23, 42, 0.04)",
        "3d-hover": "0 12px 24px -2px rgba(15, 23, 42, 0.08), 0 20px 32px -4px rgba(19, 168, 158, 0.12), inset 0 1px 0 0 rgba(255, 255, 255, 1), inset 0 -2px 0 0 rgba(15, 23, 42, 0.04)",
        "3d-btn": "0 4px 0 #06172C, 0 8px 20px rgba(11, 37, 69, 0.2)",
        "3d-btn-accent": "0 4px 0 #084c47, 0 8px 20px rgba(19, 168, 158, 0.35)",
        "glow-teal": "0 0 30px -4px rgba(19, 168, 158, 0.3)",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "float-slow": {
          "0%, 100%": { transform: "translateY(0px) rotate(0deg)" },
          "50%": { transform: "translateY(-10px) rotate(1deg)" },
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.85", transform: "scale(1.02)" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        float: "float 4s ease-in-out infinite",
        "float-slow": "float-slow 7s ease-in-out infinite",
        "pulse-subtle": "pulse-subtle 3s ease-in-out infinite",
        shimmer: "shimmer 3s ease-in-out infinite",
        marquee: "marquee 40s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
