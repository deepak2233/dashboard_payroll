# ProjectHub — Team Management Platform

Role-based management platform for tracking attendance, weekly reports, and payroll across multiple projects.

## Features

- **Role-based access** — Owner (full admin) vs Team Member (limited portal)
- **3 Projects** — I-Genie, Lenovo, Persistent
- **Attendance tracking** — Present, Absent, Leave, Half Day, WFH with calendar grid
- **Weekly reports** — Team members submit, owner reviews
- **Payroll** — Auto-calculated from attendance, pro-rata for mid-month joiners, holiday deductions
- **Email & SMS alerts** — Triggered on every attendance mark and report submission
- **Payment reminders** — 15th of month salary trigger with full breakdown

## Roles

### Owner (PIN: 1205)
Full access: Dashboard, People, Attendance, Reports, Payroll, Alerts

### Team Member (Access Code)
Limited access: Mark own attendance + Submit weekly reports only.
Each team member gets a unique 4-character access code (visible in Owner Dashboard).

## Deploy to Vercel

### Option 1: GitHub + Vercel (Recommended)

1. Push this folder to a GitHub repo:
   ```bash
   cd project-hub-vercel
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/project-hub.git
   git branch -M main
   git push -u origin main
   ```

2. Go to [vercel.com](https://vercel.com), sign in with GitHub
3. Click **"Add New Project"** → Import your repo
4. Vercel auto-detects Vite — just click **Deploy**
5. Done! Share the URL with your team

### Option 2: Vercel CLI

```bash
npm i -g vercel
cd project-hub-vercel
vercel
```

## Local Development

```bash
npm install
npm run dev
```

## Data Storage

- **Vercel deployment**: Uses `localStorage` — data persists per browser
- **Claude artifact**: Uses shared `window.storage` — data syncs across users

## Configuration

Login as Owner → Payroll → ⚙ Config:
- Manager email (for email alerts)
- Phone number (for SMS alerts)  
- HR monthly budget (splits across projects)
- Admin PIN (change from default 1205)
