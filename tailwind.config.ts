import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#faf9f7",
        bg2: "#f0ede8",
        ink: "#1a1a1a",
        mid: "#6b6560",
        faint: "#a8a29e",
        rule: "#ddd8d0",
        accent: "#c4501e",
        insurance: "#3b82f6",
        healthcare: "#10b981",
        industrials: "#f59e0b",
      },
      fontFamily: {
        serif: ["Fraunces", "Georgia", "serif"],
        sans: ["Inter", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
