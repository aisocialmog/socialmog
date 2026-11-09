/** Social Mog OS — design tokens. Only these colours are used anywhere.
 *  Semantic names (bg, card, ink, muted, accent…) switch between dark (sumi)
 *  and washi mode through the CSS variables in src/styles/index.css. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // raw palette
        sumi: { DEFAULT: '#1E1C1A', light: '#2A2724', raised: '#34302C' },
        kaki: '#E3793A',
        akane: '#B7282E',
        yamabuki: '#F2A93B',
        kinari: '#F2E8D5',
        hai: '#8F877F',
        washi: '#F7F1E6',
        // semantic (theme-aware)
        bg: 'rgb(var(--bg) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',       // kaki in both modes (fills)
        'accent-ink': 'rgb(var(--accent-ink) / <alpha-value>)', // accent used AS TEXT (AA-safe)
        alert: 'rgb(var(--alert) / <alpha-value>)',
      },
      fontFamily: {
        mincho: ['"Shippori Mincho"', 'serif'],
        sans: ['"Zen Kaku Gothic New"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { shoji: '6px' },
      transitionTimingFunction: { calm: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      transitionDuration: { calm: '300ms' },
      backgroundImage: {
        sunset: 'linear-gradient(90deg, #B7282E 0%, #E3793A 55%, #F2A93B 100%)',
      },
    },
  },
}
