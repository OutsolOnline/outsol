import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // OutSol product palette
        background: '#111315',
        surface: '#191D20',
        'surface-elevated': '#20262A',
        foreground: '#EDF2EF',
        muted: '#7F8D86',
        'text-secondary': '#ADB8B3',
        'muted-dim': '#7F8D86',
        accent: '#C5D7E3',
        border: '#2D3539',
        
        // Semantic
        primary: {
          DEFAULT: '#C5D7E3',
          foreground: '#111315',
        },
        secondary: {
          DEFAULT: '#20262A',
          foreground: '#ADB8B3',
        },
        destructive: {
          DEFAULT: '#6B4444',
          foreground: '#E0E0E0',
        },
      },
      borderRadius: {
        'terminal': '9999px', // Fully rounded pill shape
        'lg': '24px',
        'md': '16px',
        'sm': '8px',
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'JetBrains Mono', 'monospace'],
      },
      fontSize: {
        'xs': ['0.75rem', { lineHeight: '1.5', letterSpacing: '0.02em' }],
        'sm': ['0.875rem', { lineHeight: '1.6', letterSpacing: '0.01em' }],
        'base': ['1rem', { lineHeight: '1.7', letterSpacing: '0.01em' }],
        'lg': ['1.125rem', { lineHeight: '1.6', letterSpacing: '0.01em' }],
        'xl': ['1.25rem', { lineHeight: '1.5', letterSpacing: '0' }],
        '2xl': ['1.5rem', { lineHeight: '1.4', letterSpacing: '-0.01em' }],
        '3xl': ['2rem', { lineHeight: '1.3', letterSpacing: '-0.02em' }],
      },
      fontWeight: {
        light: '300',
        normal: '400',
        medium: '500',
      },
      animation: {
        'line-extend': 'line-extend 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'line-settle': 'line-settle 0.4s cubic-bezier(0.33, 1, 0.68, 1) forwards',
        'fade-in': 'fade-in 0.5s cubic-bezier(0.33, 1, 0.68, 1) forwards',
        'mass-form': 'mass-form 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        'line-extend': {
          '0%': { width: '0%', opacity: '0' },
          '60%': { width: '100%', opacity: '1' },
          '100%': { width: '100%', opacity: '1' },
        },
        'line-settle': {
          '0%': { transform: 'scaleX(0)', transformOrigin: 'left' },
          '100%': { transform: 'scaleX(1)', transformOrigin: 'left' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'mass-form': {
          '0%': { width: '2px', borderRadius: '1px' },
          '70%': { width: '8px', borderRadius: '4px' },
          '100%': { width: '6px', borderRadius: '3px' },
        },
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
    },
  },
  plugins: [],
}

export default config
