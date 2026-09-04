/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#070a0f',
          900: '#0b1017',
          850: '#101823',
          800: '#16202d',
          700: '#1f2c3c',
          600: '#2c3d52',
          500: '#41566f',
          400: '#6b8199',
          300: '#95a8bd',
          200: '#c2cede',
        },
        ghost: {
          700: '#0369a1',
          600: '#0284c7',
          500: '#38bdf8',
          400: '#7dd3fc',
          300: '#bae6fd',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,.4), 0 8px 24px -12px rgba(0,0,0,.6)',
      },
    },
  },
  plugins: [],
}
