import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { 950: "#06172C", 900: "#0B2545", 800: "#13315C", 700: "#1D4373", 100: "#DCE6F2", 50: "#F3F6FA" },
        teal: { 700: "#0A6B64", 600: "#0E7C74", 500: "#13A89E", 100: "#D6F1EE", 50: "#EEF8F7" },
        amber: { 600: "#B45309", 100: "#FEF3C7" },
        rose: { 700: "#B42318", 100: "#FEE4E2" },
      },
      fontFamily: { sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
