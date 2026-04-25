import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(220 14% 18%)",
        background: "hsl(224 18% 6%)",
        foreground: "hsl(210 40% 98%)",
        muted: "hsl(220 14% 12%)",
        "muted-foreground": "hsl(215 14% 60%)",
        card: "hsl(224 18% 8%)",
        "card-foreground": "hsl(210 40% 98%)",
        primary: "hsl(142 76% 45%)",
        "primary-foreground": "hsl(224 18% 6%)",
        danger: "hsl(0 84% 60%)",
        warn: "hsl(38 92% 55%)",
        accent: "hsl(199 89% 55%)",
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
      },
      keyframes: {
        pulse_glow: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "pulse-glow": "pulse_glow 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
