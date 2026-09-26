/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#0b0a09', 900: '#121110', 850: '#181614', 800: '#1f1c19', 700: '#2a2622', 600: '#3a342e', 500: '#5a5048', 400: '#8a7d70', 300: '#b3a697', 200: '#d8cdbf' },
        gold: { 300: '#f0d99a', 400: '#d9b86a', 500: '#c7a04a', 600: '#9c7a2f' },
        q: { unique: '#c7b377', set: '#3ad33a', magic: '#7c7cff', rare: '#f5f55a', crafted: '#ffa033', runeword: '#c7b377', normal: '#e6e0d6', superior: '#e6e0d6', low: '#8f8f8f', rune: '#ffa033', gem: '#e6e0d6', quest: '#c7b377', tempered: '#e07cff' },
      },
      fontFamily: {
        display: ['"Cinzel"', 'Georgia', 'serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      boxShadow: { tip: '0 10px 30px rgba(0,0,0,.6)' },
    },
  },
  plugins: [],
};
