import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#0B1F3A",
          50: "#EBEEF3",
          100: "#D2D9E6",
          200: "#A6B3CD",
          300: "#798DB4",
          400: "#4D679B",
          500: "#2C4A7C",
          600: "#193661",
          700: "#0B1F3A",
          800: "#08172C",
          900: "#050F1D",
        },
        secondary: {
          DEFAULT: "#0D5C4A",
          50: "#E7F2EF",
          100: "#C4E0D8",
          200: "#8FC2B0",
          300: "#5AA488",
          400: "#2C8567",
          500: "#0D5C4A",
          600: "#0A4A3B",
          700: "#08392D",
          800: "#05271F",
          900: "#031611",
        },
        accent: {
          DEFAULT: "#C8A24A",
          50: "#FAF5EA",
          100: "#F1E4C4",
          200: "#E4CC93",
          300: "#D7B562",
          400: "#C8A24A",
          500: "#AD883A",
          600: "#8A6C2E",
          700: "#675122",
          800: "#443617",
          900: "#221B0B",
        },
        neutral: {
          warm: "#FAF8F4",
          paper: "#F5F2EC",
          line: "#E5E0D6",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        content: "1280px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(11,31,58,0.04), 0 8px 24px rgba(11,31,58,0.06)",
        elevated: "0 4px 12px rgba(11,31,58,0.08), 0 16px 40px rgba(11,31,58,0.10)",
      },
      animation: {
        "fade-up": "fadeUp 0.6s ease-out forwards",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
