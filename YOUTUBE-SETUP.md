# YouTube Auto-Upload Setup (one-time, ~8 min)

Goal: authorize the autopilot to upload rendered Shorts to your YouTube channel.

## Part A — Google Cloud Console (~7 min)

1. Go to https://console.cloud.google.com/ (log in as praneeth.thommandru@gmail.com)
2. Top bar → project dropdown → **New Project** → name: `shorts-autopilot` → Create (then select it)
3. Left menu → **APIs & Services → Library** → search **"YouTube Data API v3"** → **Enable**
4. **APIs & Services → OAuth consent screen** (a.k.a. Google Auth Platform):
   - User type: **External** → Create
   - App name: `shorts-autopilot`, support email: your gmail → Save through remaining steps
   - **Audience → Test users → + Add users** → add praneeth.thommandru@gmail.com → Save
5. **APIs & Services → Credentials → + Create credentials → OAuth client ID**:
   - Application type: **Desktop app**  ← (important: Desktop, not Web)
   - Name: `shorts-uploader` → Create
6. In the popup → **Download JSON** → save the file as:
   `/Users/praneethguptha/Youtube/shorts-engine/client_secret.json`

## Part B — Authorize (1 min)

In terminal:
```bash
cd ~/Youtube/shorts-engine
node scripts/auth-youtube.mjs
```
Browser opens → pick your channel account → Allow. Done — token.json is saved.

## That's it
From then on the daily 8 AM autopilot renders AND uploads automatically.
- Manual test anytime: `node scripts/upload-youtube.mjs` (uploads as private)
- Public uploads: the daily script uses `--public` automatically
- Quota: ~6 uploads/day max (default API quota)

## Instagram (phase 2 — later)
Needs: IG switched to Business/Creator (IG app → Settings → Account type),
linked to a Facebook Page, a Facebook Developer app, and Cloudinary for public video URLs.
Ask Claude when ready.
