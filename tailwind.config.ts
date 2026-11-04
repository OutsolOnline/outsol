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
        // LaunchPier product palette; legacy accent variables stay compatible.
        background: 'var(--workspace-bg, #0E1322)',
        surface: 'var(--workspace-surface, #151D30)',
        'surface-elevated': 'var(--workspace-elevated, #1D2940)',
        foreground: 'var(--workspace-text, #EDF2FF)',
        muted: 'var(--workspace-muted, #94A3BF)',
        'text-secondary': 'var(--workspace-secondary, #B1BDD3)',
        'muted-dim': 'var(--workspace-muted, #94A3BF)',
        accent: 'var(--mint, #9FB6FF)',
        border: 'var(--workspace-border, #303E58)',
        
        // Semantic
        primary: {
          DEFAULT: 'var(--mint, #9FB6FF)',
          foreground: 'var(--accent-foreground, #0E1322)',
        },
        secondary: {
          DEFAULT: 'var(--workspace-elevated, #1D2940)',
          foreground: 'var(--workspace-secondary, #B1BDD3)',
        },
        destructive: {
          DEFAULT: '#6B4444',
          foreground: '#E0E0E0',
        },
      },
      borderRadius: {
        'terminal': '10px',
        'lg': '12px',
        'md': '10px',
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
