# 🎓 ULTIMATE BEGINNER'S GUIDE TO BUILDING YOUR ARTIST WEBSITE
## (Literally Explained Like You've Never Touched Code Before)

---

## 📖 TABLE OF CONTENTS

1. [What You're Building](#what-youre-building)
2. [What You Need Before Starting](#what-you-need-before-starting)
3. [Installing Required Software](#installing-required-software)
4. [Setting Up Your Accounts](#setting-up-your-accounts)
5. [Creating Your Database](#creating-your-database)
6. [Setting Up Email](#setting-up-email)
7. [Setting Up Spotify Integration](#setting-up-spotify-integration)
8. [Installing Your Website Code](#installing-your-website-code)
9. [Running Your Website Locally](#running-your-website-locally)
10. [Customizing Your Content](#customizing-your-content)
11. [Deploying to the Internet](#deploying-to-the-internet)
12. [Using Your Admin Panel](#using-your-admin-panel)
13. [Troubleshooting Common Problems](#troubleshooting-common-problems)

---

## 🎯 WHAT YOU'RE BUILDING

You're building a complete artist website that includes:

- **A beautiful homepage** with your music, videos, and bio
- **A shows page** where fans can see where you're performing
- **A mixes page** where people can listen to and download your DJ mixes
- **A press kit** for journalists and promoters
- **Presave pages** - like Feature.fm but FREE (fans can presave your upcoming releases)
- **Download gates** - like Hypeddit but FREE (fans follow you to unlock downloads)
- **Email list collection** - capture emails from everywhere on your site
- **Admin panel** - where YOU can create presaves and gates without coding

**This replaces paid services and saves you $600-1,680 per year.**

---

## 🛠️ WHAT YOU NEED BEFORE STARTING

### Required Items:

✅ **A computer** (Mac or Windows, doesn't matter)  
✅ **Internet connection**  
✅ **About 3-4 hours** of focused time  
✅ **Your Spotify artist account** (if you have one)  
✅ **Willingness to follow instructions carefully**

### You DO NOT Need:

❌ Coding experience  
❌ Web design skills  
❌ Expensive software  
❌ A credit card (everything is free to start)

---

## 💻 INSTALLING REQUIRED SOFTWARE

### STEP 1: Install a Code Editor (VS Code)

**What is VS Code?** It's like Microsoft Word, but for code. You'll use it to see and edit your website files.

#### On Windows:
1. Go to https://code.visualstudio.com
2. Click the big blue "Download for Windows" button
3. Open your Downloads folder
4. Double-click "VSCodeUserSetup-{version}.exe"
5. Click "Next" through all the steps
6. Click "Finish"
7. VS Code will open automatically

**Test it worked:** You should see a dark blue window with a welcome screen.

---

### STEP 2: Install Node.js

**What is Node.js?** It's the engine that runs your website code on your computer.

#### On Windows:
1. Go to https://nodejs.org
2. Click the green button that says "LTS"
3. Open your Downloads folder
4. Double-click the .msi file
5. Click "Next" through all the steps
6. Click "Install"
7. Click "Finish"

**Test it worked:**
- Press `Windows Key`, type "Command Prompt", press Enter

In the black window that opens, type this and press Enter:
```
node --version
```

You should see something like `v20.11.0`. Any version starting with `v18` or higher is perfect.

---

### STEP 3: Install Git

**What is Git?** It's a tool that tracks changes to your code and helps you upload it to the internet.

#### On Windows:
1. Go to https://git-scm.com/download/win
2. The download should start automatically
3. Open your Downloads folder
4. Double-click "Git-{version}-64-bit.exe"
5. Click "Next" through ALL the steps (don't change anything)
6. Click "Install"
7. Click "Finish"

**Test it worked:**
- Open Command Prompt
- Type this and press Enter:
```
git --version
```

You should see something like `git version 2.43.0`.

---

## 🔐 SETTING UP YOUR ACCOUNTS

You need 4 free accounts. Let's set them up one by one.

### ACCOUNT 1: GitHub (for storing your code)

**What is GitHub?** It's like Dropbox, but specifically for code. Your website code will live here.

1. Go to https://github.com
2. Click "Sign up" (top right)
3. Enter your email address
4. Click "Continue"
5. Create a password (write it down!)
6. Create a username (like "evanmilesmusic")
7. Click "Continue"
8. Solve the puzzle to prove you're human
9. Click "Create account"
10. Check your email for a verification code
11. Enter the code
12. Skip all the "personalization" questions by clicking "Skip"

**Save this info:**
- Username: _______________
- Password: _______________

---

### ACCOUNT 2: Supabase (your database)

**What is Supabase?** It's where all your data lives - your shows, mixes, presaves, emails, etc.

1. Go to https://supabase.com
2. Click "Start your project" (top right)
3. Click "Sign in with GitHub"
4. Click "Authorize supabase" (this connects your GitHub account)
5. You're now signed in!

**Creating Your Project:**

1. Click "New project" (green button)
2. Choose your organization (it will be your username)
3. Fill in the form:
   - **Name**: `evanmiles-website`
   - **Database Password**: Click the "Generate password" button
   - **IMPORTANT:** Copy this password and save it somewhere safe!
   - **Region**: Choose the one closest to where most of your fans are
   - **Pricing Plan**: Make sure "Free" is selected
4. Click "Create new project"
5. Wait 2-3 minutes for it to set up (there's a progress bar)

**Save this info:**
- Database Password: _______________

**Getting Your API Keys:**

Once your project is ready:

1. Look at the left sidebar
2. Click the "Settings" icon (looks like a gear, at the bottom)
3. Click "API" in the menu
4. You'll see a section called "Project API keys"
5. **SAVE THESE - YOU'LL NEED THEM LATER:**

Copy and paste these somewhere safe (like a Notes app):
```
Project URL: https://xxxxxxxxxxxxx.supabase.co
anon/public key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
service_role key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**⚠️ IMPORTANT:** Keep these secret! Don't share them with anyone.

---

### ACCOUNT 3: Resend (for sending emails)

**What is Resend?** This service sends emails to your fans (like "Your download is ready!").

1. Go to https://resend.com
2. Click "Start Building" (top right)
3. Click "Sign up with GitHub"
4. Click "Authorize Resend"
5. You're now signed in!

**Getting Your API Key:**

1. You'll see a welcome screen
2. On the left sidebar, click "API Keys"
3. Click "Create API Key" (blue button)
4. Name it "Production"
5. Leave "Full access" selected
6. Click "Add"
7. **SAVE THIS KEY IMMEDIATELY** - you can only see it once!

Copy this and save it:
```
Resend API Key: re_123456789...
```

---

### ACCOUNT 4: Spotify for Developers

**What is this?** This lets fans connect their Spotify account when they presave your music.

1. Go to https://developer.spotify.com/dashboard
2. Click "Log in"
3. Log in with your Spotify account (the one you use for your artist profile)
4. Accept the Terms of Service

**Creating Your App:**

1. Click "Create app" (green button)
2. Fill in the form:
   - **App name**: `Evan Miles Presave System`
   - **App description**: `Presave system for my artist website`
   - **Website**: `http://localhost:3000` (we'll change this later)
   - **Redirect URIs**: `http://localhost:3000/api/presave/spotify/callback`
     - **How to add this:** Type it in the box, then click "Add"
   - **Which API/SDKs are you planning to use?**: Check "Web API"
3. Check the box "I understand and agree..."
4. Click "Save"

**Getting Your Keys:**

1. You'll see your new app
2. Click "Settings" (top right)
3. You'll see:
   - **Client ID**: Copy this and save it
   - **Client Secret**: Click "View client secret", then copy and save it

Save these:
```
Spotify Client ID: 1234567890abcdef...
Spotify Client Secret: abcdef1234567890...
```

---

## 🗄️ CREATING YOUR DATABASE

Now let's set up the database that will store all your data.

### STEP 1: Run the Database Setup Script

1. Go back to Supabase (https://supabase.com/dashboard)
2. Click on your project (`evanmiles-website`)
3. Look at the left sidebar
4. Click on "SQL Editor" (looks like a database icon)
5. You'll see a code editor

**Now, you need to paste the SQL code. I'll provide it here:**
```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Shows table
CREATE TABLE shows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date TIMESTAMP WITH TIME ZONE NOT NULL,
  venue TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT,
  poster_url TEXT,
  video_url TEXT,
  status TEXT CHECK (status IN ('upcoming', 'past')) DEFAULT 'upcoming',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Mixes table
CREATE TABLE mixes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  tracklist TEXT,
  cover_url TEXT,
  audio_url TEXT NOT NULL,
  release_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  download_gated BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Presaves table
CREATE TABLE presaves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  upc TEXT,
  spotify_id TEXT,
  apple_music_id TEXT,
  title TEXT NOT NULL,
  artist TEXT DEFAULT 'Evan Miles',
  release_date DATE NOT NULL,
  cover_url TEXT,
  headline TEXT,
  email_template TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Presave users table
CREATE TABLE presave_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  presave_id UUID REFERENCES presaves(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  platform TEXT CHECK (platform IN ('spotify', 'apple')),
  followed BOOLEAN DEFAULT false,
  presaved BOOLEAN DEFAULT false,
  spotify_user_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Download gates table
CREATE TABLE gates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  file_url TEXT NOT NULL,
  cover_url TEXT,
  requirements JSONB DEFAULT '{"spotify_follow": false, "email": false, "instagram": false}'::jsonb,
  success_message TEXT DEFAULT 'Download unlocked! Check your email.',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Gate completions table
CREATE TABLE gate_completions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gate_id UUID REFERENCES gates(id) ON DELETE CASCADE,
  user_email TEXT,
  completed_actions JSONB DEFAULT '{}'::jsonb,
  unlocked BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Email list table
CREATE TABLE email_list (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  source TEXT,
  subscribed BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_shows_date ON shows(date DESC);
CREATE INDEX idx_presaves_slug ON presaves(slug);
CREATE INDEX idx_gates_slug ON gates(slug);
CREATE INDEX idx_presave_users_email ON presave_users(email);
CREATE INDEX idx_gate_completions_email ON gate_completions(user_email);

-- Enable Row Level Security (RLS)
ALTER TABLE shows ENABLE ROW LEVEL SECURITY;
ALTER TABLE mixes ENABLE ROW LEVEL SECURITY;
ALTER TABLE presaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE presave_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_list ENABLE ROW LEVEL SECURITY;

-- Public read access policies
CREATE POLICY "Public read shows" ON shows FOR SELECT USING (true);
CREATE POLICY "Public read mixes" ON mixes FOR SELECT USING (true);
CREATE POLICY "Public read presaves" ON presaves FOR SELECT USING (true);
CREATE POLICY "Public read gates" ON gates FOR SELECT USING (true);

-- Public insert for user-generated content
CREATE POLICY "Public insert presave_users" ON presave_users FOR INSERT WITH CHECK (true);
CREATE POLICY "Public insert gate_completions" ON gate_completions FOR INSERT WITH CHECK (true);
CREATE POLICY "Public insert email_list" ON email_list FOR INSERT WITH CHECK (true);

-- Admin full access
CREATE POLICY "Admin full shows" ON shows USING (auth.role() = 'authenticated');
CREATE POLICY "Admin full mixes" ON mixes USING (auth.role() = 'authenticated');
CREATE POLICY "Admin full presaves" ON presaves USING (auth.role() = 'authenticated');
CREATE POLICY "Admin full gates" ON gates USING (auth.role() = 'authenticated');
```

6. **Paste it into the SQL Editor**
7. **Click "Run" (bottom right)**

You should see "Success. No rows returned" - that's perfect!

---

### STEP 2: Create Storage Buckets

**What are storage buckets?** They're like folders where you'll upload images, audio files, etc.

1. In Supabase, click "Storage" in the left sidebar (looks like a folder icon)
2. Click "New bucket" (green button)

**Create these buckets one by one:**

**Bucket 1: posters**
1. Click "New bucket"
2. Name: `posters`
3. Make sure "Public bucket" is **CHECKED** ✅
4. Click "Create bucket"

**Bucket 2: mixes**
1. Click "New bucket"
2. Name: `mixes`
3. Make sure "Public bucket" is **CHECKED** ✅
4. Click "Create bucket"

**Bucket 3: covers**
1. Click "New bucket"
2. Name: `covers`
3. Make sure "Public bucket" is **CHECKED** ✅
4. Click "Create bucket"

**Bucket 4: downloads**
1. Click "New bucket"
2. Name: `downloads`
3. Make sure "Public bucket" is **UNCHECKED** ❌ (this keeps downloads private)
4. Click "Create bucket"

**Bucket 5: press**
1. Click "New bucket"
2. Name: `press`
3. Make sure "Public bucket" is **CHECKED** ✅
4. Click "Create bucket"

You should now see 5 buckets in your storage!

---

## 🚀 CREATING YOUR FIRST PRESAVE CAMPAIGN

### Scenario: New track dropping March 15th

1. **Go to `/admin`**
2. **Click "New Presave"**
3. **Fill in form:**
   - Track Title: "Lost Frequencies"
   - Release Date: March 15, 2024
   - Spotify ID: `ABC123XYZ`
   - URL Slug: auto-fills as "lost-frequencies"
   - Headline: "My most emotional track yet. Presave now."
   - Cover Image:
     - Upload to Supabase → `covers` bucket
     - Copy URL
     - Paste here

4. **Click "Create Presave Campaign"**

5. **Copy the link:**
   - `https://theevanmiles.com/presave/lost-frequencies`

6. **Share it EVERYWHERE:**
   - Instagram Stories
   - TikTok
   - Twitter/X
   - Discord

**When fans click:**
1. They enter their email
2. They choose Spotify
3. They log into Spotify
4. They automatically follow you
5. Track gets added to their library on release day
6. They get email reminder when it drops

---

## 📧 EMAIL MANAGEMENT

### View All Emails

1. Go to `/admin`
2. Dashboard shows email count
3. **Export to CSV:**
   - (You'll add this button later)
   - Download file
   - Upload to Brevo

### Emails Are Collected From:

- ✅ Homepage signup form
- ✅ Footer signup form  
- ✅ Presave campaigns
- ✅ Download gates
- ✅ Contact form (separate)

---

## 🐛 TROUBLESHOOTING

### "npm install fails"
```bash
# Delete these and try again
rm -rf node_modules package-lock.json
npm install
```

### "Supabase connection error"

- Check URLs and keys in `.env.local`
- Make sure they're the ANON key, not the service role (except for SUPABASE_SERVICE_ROLE_KEY)

### "Spotify OAuth redirect error"

- Check redirect URI exactly matches in Spotify dashboard
- No trailing slashes
- HTTPS for production, HTTP for localhost

### "Site won't load after DNS change"

- Wait 1-24 hours for DNS propagation
- Check at dnschecker.org
- Clear browser cache

---

## ✅ YOU'RE DONE!

Your site is ready to:
- Collect emails
- Create presave campaigns
- Gate downloads
- Build your fanbase

**All for FREE.** 🎉

Now go create your first presave and share it!