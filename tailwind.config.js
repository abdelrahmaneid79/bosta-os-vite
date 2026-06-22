/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Bosta Bites brand — dark jet + hot pink
        bg: "#080808",
        rail: "#0A0608",
        panel: "#120810",
        panel2: "#160910",
        line: "#2C1622",
        line2: "#1C0F16",
        pink: "#F868C8",
        berry: "#881848",
        ink: "#160910",
        text: "#FBE9F4",
        muted: "#A87C95",
        dim: "#8A6E7E",
        faint: "#6E5060",
        good: "#54D69A",
        bad: "#FF5C5C",
        warn: "#F2B33D",
        info: "#5C8DFF",
        violet: "#9B6CFF",
      },
      fontFamily: {
        display: ["Fredoka", "sans-serif"],
        sans: ["IBM Plex Sans Arabic", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      boxShadow: {
        pink: "0 8px 20px -6px rgba(248,104,200,0.6)",
        sheet: "0 24px 60px -20px rgba(0,0,0,0.8)",
        pop: "0 18px 44px -14px rgba(0,0,0,0.75)",
      },
      keyframes: {
        sheetUp: {
          from: { transform: "translateY(40px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        toastIn: {
          from: { transform: "translateY(20px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        drawerIn: {
          from: { transform: "translateX(40px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        shimmer: {
          "0%": { opacity: "0.5" },
          "50%": { opacity: "1" },
          "100%": { opacity: "0.5" },
        },
      },
      animation: {
        sheetUp: "sheetUp .24s cubic-bezier(.2,.8,.2,1)",
        toastIn: "toastIn .2s ease",
        fadeIn: "fadeIn .3s ease",
        drawerIn: "drawerIn .24s cubic-bezier(.2,.8,.2,1)",
        shimmer: "shimmer 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
