# ProjectHub — Workforce Management Platform

Role-based management for attendance, weekly reports, and payroll across I-Genie, Lenovo, and Persistent.

## How It Works

The app works immediately with **localStorage** — no database setup needed. To enable real-time sync across devices, optionally add Supabase:

### Optional: Real-Time Sync (Supabase)

1. Create a project on [Supabase.com](https://supabase.com/)
2. Run in SQL Editor:
```sql
create table settings (id text primary key, data jsonb);
alter publication supabase_realtime add table settings;
```
3. Add to Vercel Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

## Login
- **Owner**: PIN `1205`
- **Team Member**: Select name + 4-char access code (shown in Owner Dashboard)

## Local Dev
```bash
npm install && npm run dev
```
