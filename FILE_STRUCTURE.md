# 📁 Complete File Structure for theevanmiles.com

## Root Directory Files
```
theevanmiles.com/
├── .env.local.EXAMPLE          # Environment variables template
├── .gitignore                  # Git ignore file
├── package.json                # Project dependencies
├── tailwind.config.ts          # Tailwind CSS configuration
├── tsconfig.json              # TypeScript configuration
├── next.config.js             # Next.js configuration
├── postcss.config.js          # PostCSS configuration
├── vercel.json                # Vercel deployment config
├── README.md                  # Project overview
├── ULTIMATE_BEGINNER_GUIDE.md # Step-by-step setup guide
├── NAMECHEAP_SETUP.md         # DNS configuration guide
├── CUSTOMIZATION_GUIDE.md     # How to customize
└── FILE_STRUCTURE.md          # This file
```

## App Directory (Next.js 14 App Router)
```
app/
├── layout.tsx                 # Root layout (navigation, footer, theme)
├── page.tsx                   # Homepage
├── globals.css                # Global styles + glitch effects
├── not-found.tsx              # Custom 404 page
│
├── shows/
│   └── page.tsx               # Shows listing page
│
├── mixes/
│   └── page.tsx               # Mixes page with audio player
│
├── press/
│   └── page.tsx               # Press kit page
│
├── contact/
│   └── page.tsx               # Contact form page
│
├── presave/
│   └── [slug]/
│       └── page.tsx           # Dynamic presave landing pages
│
├── download/
│   └── [slug]/
│       └── page.tsx           # Dynamic download gate pages
│
├── admin/
│   ├── layout.tsx             # Admin panel layout (auth required)
│   ├── page.tsx               # Admin dashboard
│   ├── presaves/
│   │   └── new/
│   │       └── page.tsx       # Create presave campaign
│   └── gates/
│       └── new/
│           └── page.tsx       # Create download gate
│
└── api/
    ├── presave/
    │   └── spotify/
    │       └── callback/
    │           └── route.ts   # Spotify OAuth callback
    │
    ├── gates/
    │   ├── verify-email/
    │   │   └── route.ts       # Email verification
    │   ├── unlock/
    │   │   └── route.ts       # Unlock download
    │   └── spotify/
    │       └── callback/
    │           └── route.ts   # Spotify follow verification
    │
    ├── email/
    │   └── subscribe/
    │       └── route.ts       # Email signup endpoint
    │
    ├── contact/
    │   └── route.ts           # Contact form endpoint
    │
    ├── admin/
    │   └── auth/
    │       └── route.ts       # Admin authentication
    │
    └── cron/
        └── release-day/
            └── route.ts       # Scheduled release day emails
```

## Components Directory
```
components/
├── Navigation.tsx             # Top navigation bar
├── Footer.tsx                 # Site footer with email signup
├── ThemeProvider.tsx          # Dark/light mode provider
├── EmailSignup.tsx            # Reusable email signup form
└── ContactForm.tsx            # Contact form component
```

## Library Directory
```
lib/
├── supabase.ts                # Supabase client setup
├── types.ts                   # TypeScript type definitions
├── theme.ts                   # Theme configuration (colors, fonts)
└── email.ts                   # Email sending functions
```

## Public Directory (Static Assets)
```
public/
├── og-image.jpg               # Open Graph preview image (1200x630)
├── favicon.ico                # Browser tab icon
└── press/
    ├── bio.pdf                # Downloadable bio
    ├── photos/
    │   ├── evan-miles-1.jpg   # Press photo 1
    │   ├── evan-miles-2.jpg   # Press photo 2
    │   └── evan-miles-3.jpg   # Press photo 3
    └── logos/
        ├── logo-black.png     # Logo on white background
        └── logo-white.png     # Logo on black background
```

## Configuration Files Explained

### `.env.local`
Your secret keys and configuration. **NEVER commit this to Git!**

### `package.json`
Lists all the code libraries your site needs (React, Next.js, Supabase, etc.)

### `tailwind.config.ts`
Defines your design system (colors, fonts, spacing, effects)

### `vercel.json`
Tells Vercel to run your email cron job daily at 9 AM UTC

### `.gitignore`
Tells Git which files to NOT upload (like `.env.local`, `node_modules`)

## Total File Count

- **Root config files**: 10
- **App routes/pages**: 18
- **Components**: 5
- **Library files**: 4
- **Public assets**: ~10
- **Documentation**: 5

**Total: ~52 files** (not including node_modules or build files)

## Where Your Data Lives

### Supabase Database Tables:
- `shows` - Concert listings
- `mixes` - DJ mixes
- `presaves` - Presave campaigns
- `presave_users` - People who presaved
- `gates` - Download gates
- `gate_completions` - People who unlocked
- `email_list` - All email subscribers

### Supabase Storage Buckets:
- `posters` - Show posters (public)
- `mixes` - Audio files (public)
- `covers` - Cover art images (public)
- `downloads` - Gated files (private)
- `press` - Press kit assets (public)

## Development vs. Production

### When running locally (`npm run dev`):
- Files in `app/` folder
- Uses `.env.local` for config
- Runs on `http://localhost:3000`
- Hot reload (auto-updates when you save)

### When deployed to Vercel:
- Optimized/compiled version
- Uses Vercel environment variables
- Runs on `https://theevanmiles.com`
- Serverless functions for APIs

## What Each Folder Does

| Folder | Purpose | You'll Edit This? |
|--------|---------|-------------------|
| `app/` | All your pages and API routes | Sometimes (content updates) |
| `components/` | Reusable UI pieces | Rarely |
| `lib/` | Helper functions and config | Sometimes (theme colors) |
| `public/` | Images, PDFs, static files | Yes (your photos/logos) |
| `node_modules/` | Installed dependencies | Never touch this |
| `.next/` | Build output | Never touch this |

## Files You'll Edit Most

1. **Content updates**: `app/page.tsx`, `app/press/page.tsx`
2. **Color scheme**: `lib/theme.ts`
3. **Environment config**: `.env.local`
4. **Static assets**: Everything in `public/`

## Files You'll Never Touch

- Anything in `node_modules/`
- Anything in `.next/`
- Most API routes (unless adding features)
- Component files (unless customizing heavily)

## Quick Reference: "Where Do I...?"

**Change the homepage bio?**  
→ `app/page.tsx` lines 25-33

**Change site colors?**  
→ `lib/theme.ts`

**Upload a new logo?**  
→ `public/` folder, then update `components/Navigation.tsx`

**Create a presave?**  
→ Use the admin panel at `/admin`

**Export email list?**  
→ Admin dashboard → Export CSV

**Add a show?**  
→ Supabase → Table Editor → `shows` table

**Change social links?**  
→ `components/Footer.tsx` and `app/contact/page.tsx`

## This Is Your Website

You own every line of code. No dependencies on third-party platforms except:
- **Hosting**: Vercel (free tier)
- **Database**: Supabase (free tier)
- **Email**: Resend (free tier)
- **Domain**: Namecheap (your annual cost)

Everything else? **100% yours.**