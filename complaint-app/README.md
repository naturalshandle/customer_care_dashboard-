# Naturals Complaint Desk

A plain HTML/CSS/JavaScript app on top of your Supabase database.

## Files
| File | What it is |
|---|---|
| `index.html` | The page |
| `styles.css` | Look and feel |
| `app.js` | All the screens and logic |
| `config.js` | **The only file you edit** – Supabase URL, anon key, n8n photo webhook |

## 1. Add your anon key
Open `config.js` and replace `PASTE_YOUR_ANON_KEY_HERE` with the **anon / public** key
from Supabase → **Connect** (or Settings → API).
Never put the `service_role` key here.

## 2. Try it on your computer
Easiest: open the folder in VS Code and use the **Live Server** extension
(right-click `index.html` → *Open with Live Server*).
Double-clicking `index.html` usually works too.

## 3. Put it online (free)
- **Netlify:** go to app.netlify.com/drop and drag the whole folder in. You get a link to share with the team.
- Or GitHub Pages / Vercel – any static hosting works.

Only people with a login (Supabase → Authentication → Users) can see any data.

## What's in the app
- **Dashboard** – totals, open, closed, overdue, critical open, reminders due today, from CKK,
  average time to close; charts by month, status, severity, region, service, mode; open complaints by RM.
  Every tile is clickable and opens the matching list.
- **Complaints** – search (name, phone, ticket, salon, text), filters, 50 per page, export to CSV (opens in Excel).
- **Complaint page** – all details, quick status change, full change history (who changed what, when), photos.
- **New / edit complaint** – severity is required and chosen by your team; picking a Salon ID fills
  Outer ID, Location, Region, RM and CM automatically. A new Salon ID is added to the salon list automatically.

## Photos
Photo upload turns on when `N8N_PHOTO_WEBHOOK` in `config.js` is filled in (next step: the n8n workflow
that saves photos to Google Drive).
