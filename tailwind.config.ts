import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f6ff',
          100: '#dbe8ff',
          200: '#b7d0ff',
          300: '#86afff',
          400: '#4e87ff',
          500: '#1f5fff',
          600: '#1548db',
          700: '#1239b0',
          800: '#122f8b',
          900: '#11276f'
        }
      }
    }
  },
  plugins: []
};

export default config;
