/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand: {
          red: '#D61F26',
          redHover: '#B91920',
          maroon: '#4A080C',
          maroonMid: '#580A0F',
          pill: '#8B262B',
          pillHover: '#9F2D33',
          btn: '#C81E25',
          soft: '#FFF5F5',
          softPink: '#FCE7E8',
          softBorder: '#FECACA',
          surface: '#FAFAFA',
        },
      },
    },
  },
  plugins: [],
};
