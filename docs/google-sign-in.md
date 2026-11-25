# Setting up Google sign-in for the judge app

Sign-in is optional: it backs a judge's games up to their account (table
`user_games`, readable only by the owner through row-level security). These steps
are done once by the project owner. Secrets go straight into the Google and
Supabase dashboards; never paste them into chat or commit them.

Supabase project: `lwjgtahzviaqgggabykm`
Callback URL Google must allow: `https://lwjgtahzviaqgggabykm.supabase.co/auth/v1/callback`

## 1. Google Cloud: OAuth client

1. Open https://console.cloud.google.com/ and create a project (e.g. `khamtongchueam`).
2. Go to **Google Auth Platform** (APIs & Services → OAuth consent screen).
   - **Branding**: app name `คำต้องเชื่อม`, user support email, developer contact email.
   - **Audience**: User type **External**. While it is in **Testing**, only the test
     users you add (up to 100) can sign in. Add your own Google account there first.
   - **Data access**: no extra scopes needed (Supabase asks for `openid`, `email`,
     `profile`, which do not require Google's app verification).
3. Go to **Clients** → **Create client** → type **Web application**.
   - Authorized JavaScript origins: `https://khamtongchueam.vercel.app`
   - Authorized redirect URIs: `https://lwjgtahzviaqgggabykm.supabase.co/auth/v1/callback`
4. Keep the **Client ID** and **Client secret** on screen for the next step.

When ready for everyone, go back to **Audience** and press **Publish app**.

## 2. Supabase: turn Google on

1. Supabase dashboard → project → **Authentication** → **Sign In / Providers** → **Google**.
2. Enable it, paste the Client ID and Client secret, save.

## 3. Supabase: where sign-in may return to

**Authentication** → **URL Configuration**:

- Site URL: `https://khamtongchueam.vercel.app`
- Redirect URLs (add):
  - `https://khamtongchueam.vercel.app/**`
  - `https://*-nontapats-projects.vercel.app/**` (preview deployments)

## 4. Try it

Open https://khamtongchueam.vercel.app, press **เข้าสู่ระบบด้วย Google**, sign in with
a test user. The first page should then say who is signed in and when games were
last backed up.
