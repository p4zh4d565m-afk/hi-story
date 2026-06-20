/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        sidebar: { DEFAULT: '#1e1e2e', hover: '#2a2a3c', active: '#363650' },
        accent: '#7c5cfc',
      },
    },
  },
  plugins: [],
};
