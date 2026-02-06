# 🎨 Customization Guide - Make It Yours

This guide shows you how to customize every aspect of your site without breaking anything.

---

## 🌈 CHANGING COLORS (Easiest)

### The One-File Solution

Open: `lib/theme.ts`

This controls ALL colors site-wide. Change these hex codes:
```typescript
export const theme = {
  colors: {
    background: {
      dark: '#0e0e0e',     // ← Change main background
      light: '#ffffff',    // ← Light mode background
    },
    text: {
      primary: '#e6e6e6',  // ← Main text color
      secondary: '#a0a0a0',// ← Secondary text
      muted: '#6a6a6a',    // ← Subtle/placeholder text
    },
    accent: {
      blue: '#6ec8fa',     // ← Links, highlights
      amber: '#ff7b00',    // ← CTA buttons, important stuff
      green: '#00ff88',    // ← Success messages
      red: '#ff4444',      // ← Error messages
    },
  }
}
```

**Save the file → changes appear immediately** (if dev server is running)

### Current Palette (Neuropunk Liminal)

- Background: `#0e0e0e` (near-black, eerie)
- Text: `#e6e6e6` (ghost white)
- Accent Blue: `#6ec8fa` (ethereal, dreamlike)
- Accent Amber: `#ff7b00` (burnt, urgent)

### Popular Alternative Palettes

**Vaporwave:**
```typescript
accent: {
  blue: '#ff6ad5',      // Hot pink
  amber: '#00d9ff',     // Cyan
}
```

**Cyberpunk:**
```typescript
background: { dark: '#000000' },  // Pure black
accent: {
  blue: '#00fff9',     // Neon cyan
  amber: '#ff00ff',    // Neon magenta
}
```

**Minimal Brutalism:**
```typescript
background: { dark: '#ffffff' },  // White background
text: { primary: '#000000' },     // Black text
accent: {
  blue: '#0000ff',     // Pure blue
  amber: '#ff0000',    // Pure red
}
```

---

## 🔤 CHANGING FONTS

### Current Setup

- **Headings**: IBM Plex Mono (monospace, digital)
- **Body text**: System fonts (fast-loading, native)

### Option 1: Use Google Fonts

1. Go to https://fonts.google.com
2. Find a font you like (e.g., "Space Mono", "JetBrains Mono")
3. Click "Get font" → "Get embed code"
4. Copy the `<link>` tag

**Add to `app/layout.tsx`:**
```typescript
import { IBM_Plex_Mono } from 'next/font/google';

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
});

// Change to your font:
const yourFont = YourFontName({
  weight: ['400', '700'],
  subsets: ['latin'],
});
```

5. Update `tailwind.config.ts`:
```typescript
fontFamily: {
  heading: ['"Your Font Name"', 'monospace'],
  mono: ['"Your Font Name"', 'monospace'],
}
```

### Option 2: Use a Custom Font File

1. Download `.woff2` font files
2. Put them in `public/fonts/` folder
3. Add to `app/globals.css`:
```css
@font-face {
  font-family: 'MyCustomFont';
  src: url('/fonts/mycustomfont.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
}
```

4. Update `tailwind.config.ts`:
```typescript
fontFamily: {
  heading: ['"MyCustomFont"', 'sans-serif'],
}
```

---

## 🖼️ CHANGING YOUR LOGO

### Method 1: Replace Text with Image (Easiest)

1. **Upload logo to Supabase:**
   - Go to Supabase → Storage → `press` bucket
   - Create folder: `logos`
   - Upload your logo (PNG with transparent background works best)
   - Right-click → Copy URL

2. **Edit `components/Navigation.tsx`:**

Find line 24 (the glitch text):
```typescript
<span className="glitch-text" data-text="EVAN MILES">
  EVAN MILES
</span>
```

Replace with:
```typescript
<img 
  src="YOUR_LOGO_URL_HERE" 
  alt="Evan Miles" 
  className="h-8"
/>
```

3. **Adjust size:**
   - `h-8` = 32px tall (good for most logos)
   - `h-10` = 40px (bigger)
   - `h-6` = 24px (smaller)

### Method 2: Logo + Text Combo
```typescript
<div className="flex items-center gap-2">
  <img src="YOUR_LOGO_URL" alt="Logo" className="h-8 w-8" />
  <span className="font-bold text-xl">EVAN MILES</span>
</div>
```

### Method 3: Different Logo for Dark/Light Mode
```typescript
<img 
  src="/logo-dark.png" 
  alt="Logo" 
  className="h-8 dark:hidden"
/>
<img 
  src="/logo-light.png" 
  alt="Logo" 
  className="h-8 hidden dark:block"
/>
```

---

## 📝 UPDATING CONTENT

### Homepage Bio

**File**: `app/page.tsx`  
**Lines**: 25-33
```typescript
<p className="text-xl md:text-2xl...">
  YOUR NEW BIO HERE
</p>
```

### Social Links

**File**: `components/Footer.tsx`  
**Lines**: 46-85

Update URLs:
```typescript
<a href="https://instagram.com/YOUR_HANDLE">
```

### Contact Emails

**File**: `app/api/contact/route.ts`  
**Lines**: 8-13
```typescript
const recipients = {
  booking: 'youremail@example.com',
  press: 'press@example.com',
  // ...
};
```

---

## 🎨 VISUAL EFFECTS

### Glitch Intensity

**File**: `lib/theme.ts`
```typescript
effects: {
  glitchIntensity: '2px',   // Try '5px' for more intense
  grainOpacity: 0.03,       // Try 0.1 for more grain
}
```

### Grain Overlay

**File**: `app/globals.css`

Find `.grain-overlay::before` (around line 60):
```css
.grain-overlay::before {
  opacity: 0.03;  /* Change to 0.1 for more visible grain */
}
```

### Remove Grain Completely

**File**: `app/layout.tsx`

Line 45, remove `grain-overlay` class:
```typescript
// Before:
<body className={`${inter.className} grain-overlay`}>

// After:
<body className={inter.className}>
```

### Hover Effects

**File**: `app/globals.css`

Around line 80:
```css
.btn-primary {
  /* Add your hover effect */
  hover:shadow-lg hover:scale-105
}
```

---

## 🖼️ REPLACING PLACEHOLDER IMAGES

### Open Graph Image (Social Share Preview)

When people share your site on social media, this image shows.

1. Create an image: **1200x630px**
2. Save as `og-image.jpg`
3. Put in `public/` folder
4. It automatically works!

**Tips:**
- Include your artist name
- Use your brand colors
- High contrast text
- Export as JPG (smaller file)

### Favicon (Browser Tab Icon)

1. Create a square image: **512x512px**
2. Use https://favicon.io to convert to `.ico`
3. Download `favicon.ico`
4. Put in `public/` folder
5. Replace existing `favicon.ico`

---

## 📱 MOBILE CUSTOMIZATION

### Adjust Mobile Font Sizes

**File**: `app/page.tsx`

Tailwind uses responsive prefixes:
- No prefix = mobile
- `md:` = tablets
- `lg:` = desktop
```typescript
// Smaller on mobile, bigger on desktop:
<h1 className="text-4xl md:text-6xl lg:text-8xl">
  EVAN MILES
</h1>
```

### Mobile Menu (If Needed)

Currently, the nav bar shrinks on mobile. To add a hamburger menu:

1. Install package:
```bash
npm install react-burger-menu
```

2. Edit `components/Navigation.tsx` to add mobile menu
3. (This requires more advanced customization - ask Claude for help!)

---

## 🎭 ADDING CUSTOM PAGES

Want a `/about` page? Here's how:

1. Create file: `app/about/page.tsx`
2. Copy this template:
```typescript
export default function AboutPage() {
  return (
    <div className="min-h-screen py-20 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-5xl font-bold mb-8">About</h1>
        <p>Your content here...</p>
      </div>
    </div>
  );
}
```

3. Add to navigation in `components/Navigation.tsx`:
```typescript
const links = [
  // ... existing links
  { href: '/about', label: 'About' },
];
```

---

## 🎵 EMBEDDING CONTENT

### Spotify Player

Get embed code from Spotify:
1. Right-click track/album/playlist → Share → Embed
2. Copy `<iframe>` code
3. Paste in `app/page.tsx` where you want it

### YouTube Video
```typescript
<iframe
  width="100%"
  height="100%"
  src="https://www.youtube.com/embed/YOUR_VIDEO_ID"
  frameBorder="0"
  allow="accelerometer; autoplay; encrypted-media; gyroscope"
  allowFullScreen
/>
```

### Instagram Feed

**Option 1: Official Embed**
1. Go to your Instagram profile on web
2. Find a post
3. Click "..." → "Embed"
4. Copy code
5. Paste in page

**Option 2: Third-Party Widget**
- Use SnapWidget (free): https://snapwidget.com
- Or EmbedSocial
- Generate code → paste in your page

### SoundCloud Player
```typescript
<iframe
  width="100%"
  height="166"
  scrolling="no"
  frameBorder="no"
  src="https://w.soundcloud.com/player/?url=YOUR_TRACK_URL"
/>
```

---

## 🎨 ADVANCED: Custom Components

### Create a Reusable Button

1. Create `components/CustomButton.tsx`:
```typescript
export default function CustomButton({ 
  children, 
  onClick 
}: { 
  children: React.ReactNode; 
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-6 py-3 bg-neuropunk-blue text-black font-bold rounded
                 hover:bg-neuropunk-amber transition-all"
    >
      {children}
    </button>
  );
}
```

2. Use it anywhere:
```typescript
import CustomButton from '@/components/CustomButton';

<CustomButton onClick={() => alert('Clicked!')}>
  Click Me
</CustomButton>
```

---

## 🔧 TAILWIND UTILITIES CHEAT SHEET

Common classes you'll use:
```
Spacing:
p-4    = padding all sides
px-4   = padding left/right
py-4   = padding top/bottom
m-4    = margin
gap-4  = gap between flex items

Text:
text-sm, text-base, text-lg, text-xl
font-bold, font-medium
text-center, text-left
text-gray-600  (color)

Layout:
flex           = flexbox
grid           = grid layout
hidden         = hide element
md:block       = show on tablets+

Colors:
bg-black       = background
text-white     = text color
border-gray-300 = border color

Effects:
rounded-lg     = rounded corners
shadow-lg      = drop shadow
hover:scale-105 = grow on hover
transition-all  = smooth transitions
```

Full docs: https://tailwindcss.com/docs

---

## 🐛 "I Broke Something" - How to Fix

### Site Won't Load After Changes

1. Check terminal for errors
2. Look for syntax errors (missing `}`, `;`, etc.)
3. Press `Ctrl+C` to stop server
4. Run `npm run dev` again

### Styles Look Weird

1. Hard refresh browser: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)
2. Clear cache
3. Check if you closed all `className="..."` quotes

### Changes Not Showing

1. Make sure file is saved (`Cmd+S` or `Ctrl+S`)
2. Check dev server is running
3. Refresh browser

### Need to Start Over
```bash
git checkout app/page.tsx  # Revert one file
# or
git reset --hard           # Revert everything (careful!)
```

---

## 💡 Best Practices

1. **Test locally first** before deploying
2. **Make small changes** one at a time
3. **Save often** and refresh browser to see changes
4. **Use VS Code's auto-complete** (it helps prevent typos)
5. **Keep backups** of working versions
6. **Comment your code** so you remember what you changed:
```typescript
// Changed this to match new brand colors - Jan 2024
const myColor = '#6ec8fa';
```

---

## 🎯 Common Customization Goals

| Want to... | Edit this file | Line(s) |
|------------|---------------|---------|
| Change colors | `lib/theme.ts` | 5-25 |
| Add your logo | `components/Navigation.tsx` | 24 |
| Update bio | `app/page.tsx` | 25-33 |
| Change social links | `components/Footer.tsx` | 46-85 |
| Modify contact emails | `app/api/contact/route.ts` | 8-13 |
| Adjust glitch effect | `lib/theme.ts` | 32-35 |
| Remove grain overlay | `app/layout.tsx` | 45 |
| Add a new page | Create `app/yourpage/page.tsx` | N/A |

---

## 🆘 When to Ask for Help

You can customize 90% of visual stuff yourself. Ask Claude (or a dev) when:

- Adding complex features (like user authentication)
- Integrating third-party APIs
- Database schema changes
- Payment processing
- Advanced animations

For simple stuff (colors, text, images, layout): **you got this!** 💪