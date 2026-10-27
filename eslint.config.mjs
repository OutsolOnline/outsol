import nextVitals from 'eslint-config-next/core-web-vitals'
const config = [
  ...nextVitals,
  { ignores: ['.next/**', 'node_modules/**', 'vendor/**', 'next-env.d.ts'] },
  { rules: {
    '@next/next/no-img-element': 'off',
    // Client hydration and encrypted browser storage intentionally populate state in effects.
    'react-hooks/set-state-in-effect': 'off',
  } },
]
export default config
