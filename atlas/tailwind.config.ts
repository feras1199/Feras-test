import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        forest: { 50: "#eef5f0", 100: "#d6e7db", 200: "#adcfb8", 300: "#7fb291", 400: "#4f8f68", 500: "#2f714b", 600: "#205a3a", 700: "#1a4830", 800: "#153a27", 900: "#0f2b1d", 950: "#081a11" },
        stone: { 50: "#faf8f4", 100: "#f3efe7", 200: "#e6dfd2", 300: "#d2c7b4", 400: "#b3a58c", 500: "#958568", 600: "#786a52", 700: "#5f5442", 800: "#4a4235", 900: "#36302a" },
        gold: { 300: "#e5cf8e", 400: "#d7b965", 500: "#c4a047", 600: "#a5832f" },
        paper: "#fbfaf6",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      boxShadow: { card: "0 1px 2px rgba(15,43,29,.06), 0 4px 16px rgba(15,43,29,.05)" },
    },
  },
  plugins: [],
} satisfies Config;
