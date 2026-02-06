# ⚡ QUICK START - Get Live in 1 Hour

**For people who know what they're doing or just want the essentials.**

---

## 🎯 Goal

Get `theevanmiles.com` live with presave system, download gates, email collection.

---

## 📦 Setup (30 minutes)

### 1. Extract ZIP
```bash
cd ~/Downloads
unzip theevanmiles.com.zip
cd theevanmiles.com
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Create Accounts

- **Supabase**: https://supabase.com → New project
- **Resend**: https://resend.com → Get API key
- **Spotify**: https://developer.spotify.com/dashboard → Create app
- **Vercel**: https://vercel.com (for deployment)

### 4. Set Up Database

**In Supabase:**
1. SQL Editor → Run `supabase_schema` SQL
2. Storage → Create buckets: `posters`, `mixes`, `covers`, `downloads`, `press` (all public except downloads)

### 5. Configure Environment

Copy `.env.local.EXAMPLE` to `.env.local`:
```bash
cp .env.local.EXAMPLE .env.local
```

Fill in:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret

RESEND_API_KEY=your_resend_key

ADMIN_PASSWORD=YourSecurePassword123
```

### 6. Run Locally
```bash
npm run dev
```

Visit: http://localhost:3000

---

## 🚀 Deploy (15 minutes)

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

### 2. Deploy to Vercel

1. Vercel → New Project → Import from GitHub
2. Add ALL environment variables from `.env.local`
3. Change these for production:
```
   NEXT_PUBLIC_SITE_URL=https://theevanmiles.com
   NEXT_PUBLIC_SPOTIFY_REDIRECT_URI=https://theevanmiles.com/api/presave/spotify/callback
```
4. Deploy

### 3. Connect Domain (Namecheap)

**In Vercel:**
- Settings → Domains → Add `theevanmiles.com`

**In Namecheap:**
- Domain List → Manage → Advanced DNS
- Delete existing A/CNAME records
- Add:
```
  A Record    | @   | 76.76.21.21
  CNAME       | www | cname.vercel-dns.com
```
- Save

**Wait 1-24 hours for DNS propagation**

### 4. Update Spotify

- Developer Dashboard → Your App → Settings
- Add redirect URI: `https://theevanmiles.com/api/presave/spotify/callback`

---

## ✅ Test (15 minutes)

1. **Homepage**: `https://theevanmiles.com` ✅
2. **Admin**: `/admin` → Enter password ✅
3. **Create presave**: Admin → New Presave → Fill form → Get link ✅
4. **Test presave flow**: Click link → Enter email → Authorize Spotify ✅
5. **Email signup**: Homepage footer → Subscribe ✅
6. **Check database**: Supabase → email_list table → See new entry ✅

---

## 🎨 Customize (Ongoing)

### Change Colors
Edit `lib/theme.ts`:
```typescript
colors: {
  accent: {
    blue: '#YOUR_COLOR',
  }
}
```

### Update Content
- Bio: `app/page.tsx` lines 25-33
- Social links: `components/Footer.tsx`
- Spotify ID: Already set to `13cCyqArWrwa6aq9enBy8l`

### Upload Logo
1. Supabase Storage → `press` bucket
2. Upload image
3. Copy URL
4. Edit `components/Navigation.tsx` line 24

---

## 📊 Daily Use

### Create Presave Campaign
1. Go to `/admin`
2. New Presave
3. Fill in track details
4. Upload cover to Supabase `covers` bucket
5. Generate link
6. Share on social media

### Create Download Gate
1. `/admin` → New Gate
2. Upload file to Supabase `downloads` bucket
3. Set requirements (follow, email, etc.)
4. Generate link
5. Share

### Export Emails
1. `/admin` → Dashboard
2. Click "Export CSV"
3. Upload to Brevo

---

## 🐛 Common Issues

**"npm install fails"**
```bash
rm -rf node_modules package-lock.json
npm install
```

**"Supabase connection error"**
- Check URLs and keys in `.env.local`
- Make sure they're the ANON key, not the service role

**"Spotify OAuth redirect error"**
- Check redirect URI exactly matches in Spotify dashboard
- No trailing slashes
- HTTPS for production, HTTP for localhost

**"Site won't load after DNS change"**
- Wait 1-24 hours
- Check at dnschecker.org
- Clear browser cache

---

## 📁 Key Files

| File | What It Does |
|------|--------------|
| `app/page.tsx` | Homepage |
| `app/admin/presaves/new/page.tsx` | Create presaves |
| `lib/theme.ts` | Colors and fonts |
| `.env.local` | Secret keys |
| `components/Footer.tsx` | Social links |

---

## 🎯 Your Spotify Info (Already Configured)
```
Artist: Evan Miles
Spotify ID: 13cCyqArWrwa6aq9enBy8l
URL: https://open.spotify.com/artist/13cCyqArWrwa6aq9enBy8l

Social:
- Instagram: @theevanmiles
- SoundCloud: @theevanmiles  
- YouTube: @theevanmiles
- TikTok: @yungmiley

Emails:
- General/Booking/Press: info@theevanmiles.com
- Collaborations: evanmilessounds@gmail.com
```

---

## 💡 Pro Tips

1. **Test locally first** before deploying
2. **Use admin panel** for presaves/gates (don't manually edit database)
3. **Export emails weekly** to Brevo as backup
4. **Check Vercel logs** if something breaks (Vercel dashboard → your project → Logs)
5. **Keep `.env.local` secret** - never commit to Git

---

## 🎉 You're Done!

Your site is live. You have:
- ✅ Custom domain
- ✅ Presave system
- ✅ Download gates
- ✅ Email collection
- ✅ Admin panel
- ✅ Contact form
- ✅ Press kit

**Cost**: ~$0/month (free tiers)  
**Savings**: $600-1,680/year vs. third-party services

Now go create your first presave campaign and share it! 🚀