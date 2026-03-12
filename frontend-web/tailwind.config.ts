import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "surface-card": "#FFFFFF",
        "surface-soft": "#F5F7F8",
        primary: {
          DEFAULT: "#4A6CF7",
          light: "#7A96F9",
          soft: "#E0E7FF",
        },
        accent: {
          green: "#5B9BD5",
          mint: "#B0C8EE",
          blue: "#8EC9F7",
          purple: "#A69BFF",
          orange: "#F5B266",
          yellow: "#FFD76A",
        },
        ink: {
          DEFAULT: "#1E1F23",
          secondary: "#6B7280",
          muted: "#9CA3AF",
        },
        status: {
          success: "#63D69E",
          warning: "#F5B266",
          info: "#8EC9F7",
          danger: "#FF6B6B",
        },
        "border-soft": "#E6E8EC",
      },
      borderRadius: {
        xs: "6px",
        sm: "10px",
        md: "16px",
        lg: "20px",
        xl: "24px",
        pill: "999px",
      },
      boxShadow: {
        card: "0px 8px 24px rgba(0,0,0,0.05)",
        hover: "0px 12px 32px rgba(0,0,0,0.08)",
        soft: "0px 4px 12px rgba(0,0,0,0.04)",
      },
      fontFamily: {
        sans: ["Inter", "SF Pro Display", "Helvetica Neue", "sans-serif"],
      },
      fontSize: {
        display: ["32px", { lineHeight: "1.2", fontWeight: "700" }],
        h1: ["24px", { lineHeight: "1.2", fontWeight: "700" }],
        h2: ["20px", { lineHeight: "1.2", fontWeight: "600" }],
        h3: ["18px", { lineHeight: "1.4", fontWeight: "600" }],
        "body-lg": ["16px", { lineHeight: "1.6", fontWeight: "500" }],
        body: ["14px", { lineHeight: "1.4", fontWeight: "400" }],
        caption: ["12px", { lineHeight: "1.4", fontWeight: "500" }],
      },
    },
  },
  plugins: [],
};

export default config;
