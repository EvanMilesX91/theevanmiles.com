// Neuropunk Liminal Theme Configuration
// Change colors here to customize the entire site

export const theme = {
  colors: {
    // Primary palette
    background: {
      dark: '#0e0e0e',      // Almost black
      light: '#ffffff',      // White (for light mode)
    },
    text: {
      primary: '#e6e6e6',    // Ghost white
      secondary: '#a0a0a0',  // Medium gray
      muted: '#6a6a6a',      // Subtle gray
    },
    accent: {
      blue: '#6ec8fa',       // Ethereal blue (links, highlights)
      amber: '#ff7b00',      // Burnt amber (CTAs, warnings)
      green: '#00ff88',      // Success states
      red: '#ff4444',        // Errors
    },
    border: {
      subtle: '#2a2a2a',     // Dark gray borders
      medium: '#3a3a3a',     // Medium borders
      bright: '#6ec8fa',     // Highlighted borders
    },
    overlay: {
      grain: 'rgba(255, 255, 255, 0.03)',  // VHS grain
      blur: 'rgba(14, 14, 14, 0.8)',        // Backdrop blur
    }
  },

  // Typography
  fonts: {
    heading: '"IBM Plex Mono", monospace',
    body: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    mono: '"IBM Plex Mono", "Courier New", monospace',
  },

  // Effects
  effects: {
    glitchIntensity: '2px',      // Glitch offset
    grainOpacity: 0.03,          // Grain overlay strength
    blurAmount: '12px',          // Backdrop blur
    transitionSpeed: '200ms',    // Default transitions
    hoverGlow: '0 0 20px rgba(110, 200, 250, 0.3)',
  },

  // Spacing (Tailwind scale)
  spacing: {
    xs: '0.25rem',   // 4px
    sm: '0.5rem',    // 8px
    md: '1rem',      // 16px
    lg: '1.5rem',    // 24px
    xl: '2rem',      // 32px
    xxl: '3rem',     // 48px
  },
}

export default theme;