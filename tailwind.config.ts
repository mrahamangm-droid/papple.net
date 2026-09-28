import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0b1220",
        paper: "#f7f5f0",
        brand: {
          50: "#eef4f3",
          100: "#d7e6e3",
          400: "#4d8b83",
          600: "#2f6b63",
          700: "#245149",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
