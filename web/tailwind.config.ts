import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        paper: "#f5f1e8",
        sand: "#ece4d4",
        moss: "#5b6b5f",
        ember: "#c96c4a"
      },
      boxShadow: {
        panel: "0 24px 80px rgba(15, 23, 42, 0.08)"
      },
      borderRadius: {
        panel: "1.5rem"
      }
    }
  },
  plugins: []
};

export default config;
