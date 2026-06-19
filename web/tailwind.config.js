/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#000000",
        spec: "#38bdf8",
        coder: "#a78bfa",
        tester: "#fbbf24",
        repairer: "#34d399",
        conductor: "#8b94a3",
        pass: "#34d399",
        fail: "#f43f5e",
      },
      fontFamily: {
        display: ["Bricolage Grotesque", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["Hanken Grotesk", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 var(--ring, rgba(255,255,255,0.4))" },
          "100%": { boxShadow: "0 0 0 16px rgba(255,255,255,0)" },
        },
        riseIn: {
          "0%": { opacity: "0", transform: "translateY(12px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        stationIn: {
          "0%": { opacity: "0", transform: "translateY(18px) scale(0.96)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        drawLine: {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" },
        },
        glow: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        blip: {
          "0%": { opacity: "0.2" },
          "50%": { opacity: "1" },
          "100%": { opacity: "0.2" },
        },
        fadeScale: {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        pulseRing: "pulseRing 1.2s ease-out infinite",
        riseIn: "riseIn 0.55s cubic-bezier(0.22,1,0.36,1) both",
        stationIn: "stationIn 0.85s cubic-bezier(0.22,1,0.36,1) both",
        drawLine: "drawLine 0.9s cubic-bezier(0.22,1,0.36,1) 0.3s both",
        glow: "glow 1.8s ease-in-out infinite",
        blip: "blip 1.4s ease-in-out infinite",
        fadeScale: "fadeScale 0.6s cubic-bezier(0.22,1,0.36,1) both",
        slideUp: "slideUp 0.75s cubic-bezier(0.22,1,0.36,1) both",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.22, 1, 0.36, 1)",
        smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
