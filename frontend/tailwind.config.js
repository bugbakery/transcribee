/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        brutal: '5px 5px #000',
      },
      keyframes: {
        rainbow: {
          '0%': { color: '#db0000' },
          '15%': { color: '#f1b500' },
          '45%': { color: '#00bd2c' },
          '60%': { color: '#00b9b3' },
          '75%': { color: '#0091ff' },
          '90%': { color: '#b405a5' },
          '100%': { color: '#db0000' },
        },
      },
      animation: {
        rainbow: 'rainbow 6s linear infinite;',
        'spin-slow': 'spin 1s linear infinite',
      },
      width: { 'very-large-dialog': '60rem' },
    },
    fontFamily: {
      sans: [
        'Inter',
        '-apple-system',
        'BlinkMacSystemFont',
        'Segoe UI',
        'Noto Sans',
        'Helvetica',
        'Arial',
        'sans-serif',
        'Apple Color Emoji',
        'Segoe UI Emoji',
      ],
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
};
