/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        sidebar: { DEFAULT: '#1e2621', hover: '#2a352c', active: '#374938' },
        accent: '#7fb380',
        'accent-hover': '#669468',
      },
    },
  },
  plugins: [],
};
