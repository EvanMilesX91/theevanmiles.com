# 🌐 Namecheap DNS Setup for theevanmiles.com

## Overview

You'll connect your Namecheap domain (`theevanmiles.com`) to your Vercel-hosted website.

**Time needed**: 15 minutes setup + 1-24 hours for DNS propagation  
**Cost**: $0 (you already own the domain)

---

## ✅ What You're Doing

1. Telling Namecheap where your website lives (Vercel's servers)
2. Getting free SSL certificate automatically from Vercel
3. Making `theevanmiles.com` and `www.theevanmiles.com` both work

---

## 📋 Prerequisites

- [ ] Domain purchased: `theevanmiles.com` ✅
- [ ] Website deployed to Vercel ✅
- [ ] Namecheap account login info ready

---

## PART 1: In Vercel (Do This First)

### Step 1: Deploy Your Site

1. Go to https://vercel.com
2. Your project should be deployed
3. It gets a URL like: `theevanmiles.vercel.app`
4. **Keep this page open** - you'll need info from here

### Step 2: Add Your Custom Domain

1. In your Vercel project dashboard
2. Click **"Settings"** (top menu)
3. Click **"Domains"** (left sidebar)
4. In the box, type: `theevanmiles.com`
5. Click **"Add"**

**You'll see a screen that says "Invalid Configuration"** - this is normal!

### Step 3: Get Your DNS Records

Vercel will show you exactly what DNS records to add. It looks like this:
```
Type: A
Name: @
Value: 76.76.21.21

Type: CNAME  
Name: www
Value: cname.vercel-dns.com
```

**Write these down or take a screenshot!**

---

## PART 2: In Namecheap (Do This Second)

### Step 1: Log Into Namecheap

1. Go to https://www.namecheap.com
2. Click "Sign In" (top right)
3. Enter your username and password

### Step 2: Go to Your Domain

1. Click **"Domain List"** (left sidebar)
2. Find `theevanmiles.com`
3. Click **"Manage"** button next to it

### Step 3: Access DNS Settings

1. You're now on the domain management page
2. Click the **"Advanced DNS"** tab (top menu)
3. You'll see a section called **"Host Records"**

### Step 4: Delete Existing Records

**IMPORTANT:** You need to start fresh.

In the "Host Records" section, you'll see existing records. Delete these:

- Any "A Record" with host `@`
- Any "A Record" with host `www`
- Any "CNAME Record" with host `www`
- **KEEP** the "URL Redirect Record" if you want (won't interfere)
- **KEEP** any email-related records (MX, TXT for email)

**How to delete:**
- Click the trash can icon 🗑️ next to each record
- Click "Yes, delete" when asked

### Step 5: Add New DNS Records

Now add the records Vercel gave you.

**Record 1: Point root domain to Vercel**

1. Click **"Add New Record"** button
2. Fill in:
   - **Type**: `A Record`
   - **Host**: `@`
   - **Value**: `76.76.21.21` (Vercel's IP address)
   - **TTL**: `Automatic`
3. Click the green checkmark ✅ to save

**Record 2: Point www subdomain to Vercel**

1. Click **"Add New Record"** button again
2. Fill in:
   - **Type**: `CNAME Record`
   - **Host**: `www`
   - **Value**: `cname.vercel-dns.com`
   - **TTL**: `Automatic`
3. Click the green checkmark ✅ to save

**Screenshot of how it should look:**
```
Type        Host    Value                  TTL
────────────────────────────────────────────────
A Record    @       76.76.21.21            Automatic
CNAME       www     cname.vercel-dns.com   Automatic
```

### Step 6: Save Changes

1. Scroll to the bottom
2. Click **"Save All Changes"**
3. You'll see a green success message

---

## PART 3: Back to Vercel (Verify It Worked)

### Step 1: Check Vercel Dashboard

1. Go back to Vercel → Settings → Domains
2. Refresh the page
3. You might see "Pending" or "Valid Configuration"

### Step 2: Wait for DNS Propagation

**How long?** Usually 15 minutes to 1 hour. Can take up to 24 hours.

**How to check if it's working:**

**Option A: Use a DNS checker**
1. Go to https://dnschecker.org
2. Enter: `theevanmiles.com`
3. Select type: `A`
4. Click "Search"
5. You should see `76.76.21.21` appear across multiple locations

**Option B: Try your website**
1. Open a new browser tab
2. Go to: `http://theevanmiles.com` (no https yet)
3. If it loads → DNS is working!
4. If it doesn't → wait 30 more minutes and try again

### Step 3: SSL Certificate (Automatic)

Once DNS is connected:

1. Vercel automatically issues an SSL certificate
2. This takes 5-10 minutes
3. Your site will then work at `https://theevanmiles.com` 🔒
4. Both `http` and `https` redirect to the secure version

**You don't need to do anything for SSL!** Vercel handles it.

---

## PART 4: Update Environment Variables

Now that your site is on a custom domain, update these:

1. In Vercel → Settings → Environment Variables
2. Find `NEXT_PUBLIC_SITE_URL`
3. Change from `https://theevanmiles.vercel.app`
4. To: `https://theevanmiles.com`
5. Click "Save"

6. Find `NEXT_PUBLIC_SPOTIFY_REDIRECT_URI`
7. Change to: `https://theevanmiles.com/api/presave/spotify/callback`
8. Click "Save"

9. **Redeploy your site:**
   - Go to "Deployments" tab
   - Click the three dots ⋯ next to latest deployment
   - Click "Redeploy"
   - Wait 2 minutes

---

## PART 5: Update Spotify Developer Dashboard

Your Spotify app needs to know about the new domain.

1. Go to https://developer.spotify.com/dashboard
2. Click on your app
3. Click **"Settings"**
4. Find "Redirect URIs"
5. Click **"Add"**
6. Add: `https://theevanmiles.com/api/presave/spotify/callback`
7. **Keep the localhost one too** (for testing):
   - `http://localhost:3000/api/presave/spotify/callback`
8. Click **"Save"**

You should now have 2 redirect URIs:
- ✅ `http://localhost:3000/api/presave/spotify/callback` (for development)
- ✅ `https://theevanmiles.com/api/presave/spotify/callback` (for production)

---

## ✅ Final Checklist

- [ ] DNS records added in Namecheap
- [ ] DNS propagated (check at dnschecker.org)
- [ ] Site loads at `https://theevanmiles.com`
- [ ] SSL certificate showing (🔒 in browser)
- [ ] Both `theevanmiles.com` and `www.theevanmiles.com` work
- [ ] Environment variables updated in Vercel
- [ ] Site redeployed
- [ ] Spotify redirect URI updated

---

## 🧪 Test Everything

1. **Homepage**: Go to `https://theevanmiles.com`
   - Should load with padlock 🔒
   
2. **WWW redirect**: Go to `https://www.theevanmiles.com`
   - Should redirect to `https://theevanmiles.com`
   
3. **Admin panel**: Go to `https://theevanmiles.com/admin`
   - Should ask for password
   
4. **Create test presave**: `/admin` → New Presave
   - Fill it in
   - Get link like: `https://theevanmiles.com/presave/test-track`
   
5. **Test Spotify OAuth**:
   - Go to your presave link
   - Enter email
   - Click "Presave on Spotify"
   - Should redirect to Spotify login
   - Authorize
   - Should come back to success page

**If all of this works → YOU'RE LIVE! 🎉**

---

## 🐛 Troubleshooting

### "Site not found" or "DNS_PROBE_FINISHED_NXDOMAIN"

**Problem**: DNS hasn't propagated yet  
**Solution**: Wait 1-2 hours, try again

### "Not Secure" warning / No padlock 🔒

**Problem**: SSL certificate not issued yet  
**Solution**: 
1. Check Vercel dashboard → Domains
2. Make sure domain shows "Valid"
3. Wait 15 minutes for SSL
4. Clear browser cache and try again

### WWW doesn't work

**Problem**: CNAME record missing  
**Solution**:
1. Go back to Namecheap → Advanced DNS
2. Make sure you have: `CNAME | www | cname.vercel-dns.com`
3. Save changes
4. Wait 30 minutes

### Spotify OAuth fails with "Redirect URI mismatch"

**Problem**: Redirect URI not updated in Spotify  
**Solution**:
1. Check Spotify Developer Dashboard → your app → Settings
2. Make sure `https://theevanmiles.com/api/presave/spotify/callback` is listed
3. Make sure there's no typo
4. Try again

### "This site can't be reached"

**Problem**: DNS records wrong  
**Solution**:
1. Double-check Namecheap records match exactly:
   - A Record: `@` → `76.76.21.21`
   - CNAME: `www` → `cname.vercel-dns.com`
2. Use dnschecker.org to verify
3. Wait for propagation

---

## 📧 Zoho Mail Setup (Since You Mentioned It)

If you're using Zoho for `info@theevanmiles.com`:

**Your DNS should also have these records** (don't delete them!):
```
Type    Host    Value
────────────────────────────────────
MX      @       mx.zoho.com (Priority 10)
MX      @       mx2.zoho.com (Priority 20)
TXT     @       v=spf1 include:zoho.com ~all
```

These handle your email separately from your website. They won't conflict.

**If Zoho email stops working after DNS changes:**
1. Go to Zoho control panel
2. Get your MX and TXT records
3. Re-add them to Namecheap Advanced DNS
4. Save
5. Wait 1 hour

---

## 🎯 Summary

**What you did:**
- Pointed `theevanmiles.com` to Vercel's servers
- Got free SSL certificate
- Updated all URLs to use your custom domain
- Tested everything works

**What happens now:**
- Your website is live at your custom domain
- Fans can visit `theevanmiles.com`
- Presaves work with Spotify
- Emails get collected
- You look professional AF 🔥

**Total cost:**
- Domain: ~$15/year (you already have this)
- Hosting: $0 (Vercel free tier)
- SSL: $0 (automatic from Vercel)
- Database: $0 (Supabase free tier)
- Email sending: $0 (Resend free tier)

You just saved $600-1,680/year by not using third-party presave/gate services! 💰