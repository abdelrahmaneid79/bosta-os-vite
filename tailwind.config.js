/** @type {import('tailwindcss').Config} */
const c = (v) => `rgb(var(${v}) / <alpha-value>)`;
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Bosta Bites — neutral premium surfaces + brand pink. Driven by CSS
        // variables in index.css so light/dark swap with one class on <html>.
        bg: c("--bg"),
        rail: c("--rail"),
        panel: c("--panel"),
        panel2: c("--panel2"),
        line: c("--line"),
        line2: c("--line2"),
        pink: c("--pink"),
        pinkBright: c("--pink-bright"),
        berry: c("--berry"),
        ink: c("--ink"),
        text: c("--text"),
        muted: c("--muted"),
        dim: c("--dim"),
        faint: c("--faint"),
        good: c("--good"),
        bad: c("--bad"),
        warn: c("--warn"),
        info: c("--info"),
        violet: c("--violet"),
      },
      fontFamily: {
        display: ["Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
        sans: ["Inter", "IBM Plex Sans Arabic", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        "4xl": "28px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        pop: "var(--shadow-pop)",
        pink: "var(--shadow-pink)",
        sheet: "var(--shadow-pop)",
      },
      keyframes: {
        sheetUp: { from: { transform: "translateY(40px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        toastIn: { from: { transform: "translateY(20px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        rise: { from: { transform: "translateY(8px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        drawerIn: { from: { transform: "translateX(40px)", opacity: "0" }, to: { transform: "translateX(0)", opacity: "1" } },
        shimmer: { "0%": { opacity: "0.5" }, "50%": { opacity: "1" }, "100%": { opacity: "0.5" } },
      },
      animation: {
        sheetUp: "sheetUp .24s cubic-bezier(.2,.8,.2,1)",
        toastIn: "toastIn .2s ease",
        fadeIn: "fadeIn .3s ease",
        rise: "rise .35s cubic-bezier(.2,.8,.2,1) both",
        drawerIn: "drawerIn .24s cubic-bezier(.2,.8,.2,1)",
        shimmer: "shimmer 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
