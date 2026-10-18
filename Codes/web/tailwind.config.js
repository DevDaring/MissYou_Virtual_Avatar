/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        night: { 950: '#0b0818', 900: '#14102a', 800: '#1e1838', 700: '#2a2250', 600: '#3a3068' },
        dusk: { 500: '#8f7ad6', 400: '#b3a2ee', 300: '#d2c7ff' },
        ember: { 600: '#e0794f', 500: '#f0925f', 400: '#f7b07c', 300: '#fbd0a6' },
        rose: { 400: '#f19bb0', 300: '#f7c1cf' },
        cream: { 50: '#fff9f1', 100: '#fbefe0', 200: '#efdfca' },
      },
      fontFamily: {
        serif: ['Fraunces', 'Noto Serif Bengali', 'Noto Serif Devanagari', 'Georgia', 'serif'],
        sans: ['Nunito Sans', 'Noto Sans Bengali', 'Noto Sans Devanagari', 'system-ui', 'sans-serif'],
      },
      boxShadow: { glow: '0 0 40px -8px rgba(240,146,95,0.55)' },
    },
  },
  plugins: [],
}
