import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      colors: {
        border: 'rgba(255, 255, 255, 0.2)',
        // New homepage colors
        base: '#181721',
        memory: '#422455',
        bone: '#eae9d1',
        spike: '#cf3a00',
      },
    },
  },
  plugins: [],
};

export default config;