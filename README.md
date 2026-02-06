# 🎧 theevanmiles.com

**Your complete artist website with presave system, download gates, and email collection. Zero third-party fees.**

---

## 🌟 What This Is

A fully custom artist website that replaces:
- ✅ Feature.fm ($10-30/month) → Built-in presave system
- ✅ Hypeddit ($10-20/month) → Built-in download gates
- ✅ Linktree ($5-10/month) → Custom landing page
- ✅ Email services ($10-50/month) → Integrated email collection
- ✅ Website builders ($15-30/month) → Custom Next.js site

**Total savings: $600-1,680/year**

---

## ✨ Features

### Public-Facing
- **Homepage** - Bio, Spotify/YouTube embeds, Instagram feed, email signup
- **Shows** - Upcoming and past performance listings
- **Mixes** - Audio player, downloads, tracklists
- **Press Kit** - Downloadable assets for media
- **Contact Form** - Categorized inquiries routed to correct emails

### Fan Tools
- **Presave Campaigns** - Fans connect Spotify, follow you, presave releases
- **Download Gates** - Follow-to-unlock for exclusive content
- **Email Signups** - Multiple collection points throughout site

### Admin Tools
- **Password-protected Dashboard** - View stats, manage content
- **Presave Creator** - Generate presave pages in seconds
- **Gate Creator** - Set up download gates with custom requirements
- **Email Export** - Download subscriber list as CSV

### Technical
- **Neuropunk Liminal Aesthetic** - Dark, glitchy, dreamlike design
- **Fully Responsive** - Perfect on mobile, tablet, desktop
- **SEO Optimized** - Proper meta tags, Open Graph, sitemaps
- **Dark Mode** - User-controlled light/dark theme
- **Custom 404** - Branded error page

---

## 🚀 Quick Start

**For detailed setup**: See `ULTIMATE_BEGINNER_GUIDE.md`  
**For fast setup**: See `QUICK_START.md`

### TL;DR
```bash
# 1. Install
npm install

# 2. Set up .env.local
cp .env.local.EXAMPLE .env.local
# Fill in your API keys

# 3. Run Supabase SQL
# Paste supabase_schema SQL in Supabase SQL Editor

# 4. Start dev server
npm run dev

# 5. Deploy
git push
# Connect to Vercel, add domain
```

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| `ULTIMATE_BEGINNER_GUIDE.md` | Complete step-by-step for absolute beginners |
| `QUICK_START.md` | Fast setup for experienced devs |
| `NAMECHEAP_SETUP.md` | DNS configuration for your domain |
| `CUSTOMIZATION_GUIDE.md` | How to change colors, fonts, content |
| `FILE_STRUCTURE.md` | What every file does |
| `README.md` | This file |

---

## 🎨 Customization

### Colors
Edit `lib/theme.ts` - change any hex code, entire site updates.

### Logo
Upload to Supabase → Update `components/Navigation.tsx` line 24

### Content
- Bio: `app/page.tsx`
- Social links: `components/Footer.tsx`  
- Contact emails: `app/api/contact/route.ts`

**Full guide**: `CUSTOMIZATION_GUIDE.md`

---

## 🛠️ Tech Stack

- **Framework**: Next.js 14 (React)
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage
- **Auth**: Spotify OAuth, Simple password (admin)
- **Email**: Resend
- **Hosting**: Vercel
- **Domain**: Namecheap

**All using free tiers except domain ($15/year)**

---

## 📊 Your Info (Pre-Configured)
```
Artist: Evan Miles
Domain: theevanmiles.com
Spotify: https://open.spotify.com/artist/13cCyqArWrwa6aq9enBy8l

Social:
- Instagram: @theevanmiles
- SoundCloud: @theevanmiles
- YouTube: @theevanmiles
- TikTok: @yungmiley

Emails:
- General/Booking/Press: info@theevanmiles.com
- Collaborations: evanmilessounds@gmail.com

Theme: Neuropunk Liminal
- Background: #0e0e0e (near-black)
- Accent Blue: #6ec8fa (ethereal)
- Accent Amber: #ff7b00 (burnt)
```

---

## 🎯 Common Tasks

### Create Presave Campaign
1. Go to `/admin`
2. Click "New Presave"
3. Fill in track info
4. Upload cover to Supabase
5. Generate link
6. Share on social media

### Create Download Gate
1. Go to `/admin`  
2. Click "New Gate"
3. Upload file to Supabase
4. Set unlock requirements
5. Generate link
6. Share

### Export Email List
1. Go to `/admin`
2. Dashboard → "Export CSV"
3. Upload to Brevo

---

## 🐛 Troubleshooting

**Site won't start**
```bash
rm -rf node_modules package-lock.json
npm install
npm run dev
```

**Database errors**
- Check Supabase URL and keys in `.env.local`
- Make sure SQL schema ran successfully
- Verify storage buckets created

**Spotify OAuth fails**
- Check redirect URI in Spotify Developer Dashboard
- Must exactly match: `https://theevanmiles.com/api/presave/spotify/callback`
- No trailing slash

**Deploy fails on Vercel**
- Check all environment variables added
- Verify no syntax errors (run `npm run build` locally first)

**Full troubleshooting**: See guide documents

---

## 📁 Project Structure
```
app/          - All pages and API routes
components/   - Reusable UI components  
lib/          - Helper functions, config
public/       - Static files (images, PDFs)
```

**Detailed breakdown**: `FILE_STRUCTURE.md`

---

## 🔐 Security

- ✅ Environment variables never committed to Git
- ✅ Admin panel password-protected  
- ✅ Service role keys kept server-side only
- ✅ RLS policies on all database tables
- ✅ Private storage for gated downloads
- ✅ HTTPS everywhere (Vercel auto-SSL)

---

## 📈 Roadmap / Future Features

Want to add later:
- [ ] Direct file uploads in admin (currently via Supabase)
- [ ] Apple Music presave integration
- [ ] Advanced analytics dashboard
- [ ] Bulk email sender (integrated with Brevo)
- [ ] Fan chat/comments
- [ ] Ticket giveaways
- [ ] Merch store integration

The codebase is structured to make these additions easy.

---

## 🤝 Support

**For setup help**: Read the guides (especially `ULTIMATE_BEGINNER_GUIDE.md`)

**For bugs**: Check browser console, Vercel logs

**For customization**: See `CUSTOMIZATION_GUIDE.md`

**For advanced features**: Ask Claude or hire a dev

---

## 📜 License

This is YOUR website. You own all the code. No licenses, no restrictions.

Use it, modify it, sell it as a template to other artists if you want!

---

## 🎉 You're Ready

This is a complete, production-ready artist website that:
- Looks professional
- Works on all devices  
- Collects emails
- Enables presaves
- Gates downloads
- Costs almost nothing to run

**Now go create your first presave campaign and share it!** 🚀

---

Built with ❤️ using Next.js, Supabase, and Tailwind CSS  
Designed for Evan Miles | theevanmiles.com