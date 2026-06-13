/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // TailAdmin 主色系
        brand: {
          50: "#ecf3ff", 100: "#dde9ff", 200: "#c2d6ff", 300: "#9cb9ff",
          400: "#7592ff", 500: "#465fff", 600: "#3641f5", 700: "#2a31d8",
          800: "#252dae", 900: "#262e89", 950: "#161950",
        },
        gray: {
          50: "#f9fafb", 100: "#f2f4f7", 200: "#e4e7ec", 300: "#d0d5dd",
          400: "#98a2b3", 500: "#667085", 600: "#475467", 700: "#344054",
          800: "#1d2939", 900: "#101828", 950: "#0c111d",
        },
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
      boxShadow: { card: "0 1px 3px 0 rgba(16,24,40,0.1)" },
    },
  },
  plugins: [],
};
