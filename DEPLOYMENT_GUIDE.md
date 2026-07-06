# 🚀 SAIVI'S Collection Deployment & Hosting Guide

This document contains the step-by-step instructions to deploy and host the SAIVI'S Collection clothing store app on **Render (Backend)** and **Vercel (Frontend)**. It also summarizes the current configuration of the project.

---

## 📋 Current Project Status
- **GitHub Repository:** Pushed to `https://github.com/Mukil630/saivi-collection.git`
- **Database & Image Storage:** Configured to use **Supabase** (PostgreSQL Database & Supabase Storage for persistent images).
- **Cloud-Ready Code:** The port, database connections, and API endpoints are fully dynamic and read from environment variables.

---

## 🛠️ Step 1: Deploy Backend on Render

Render hosts the Node.js API server and connects it to the Supabase database.

### Render Configuration Settings:
1. **New Web Service:** Connect your GitHub account and select the `saivi-collection` repository.
2. **Settings:**
   - **Name:** `saivi-collection-backend` (or similar)
   - **Region:** `Singapore (Southeast Asia)`
   - **Branch:** `main`
   - **Root Directory:** `backend`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
   - **Instance Type:** `Free`

### Environment Variables:
Click **"Add from .env"** in the Environment Variables section and paste the following keys and values from your local `backend/.env` file:
```env
PORT=5000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=siva@123
SUPABASE_DB_URL=postgresql://postgres:Mukil%4016030@db.niddxeottigiibqjouyp.supabase.co:5432/postgres
SUPABASE_URL=https://nkclvcdbdaxwtuwhvgnf.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rY2x2Y2RiZGF4d3R1d2h2Z25mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzA4ODI5OSwiZXhwIjoyMDk4NjY0Mjk5fQ.YyUZV-JjD1kletCNd3nDshzk99yE8mDX0l-3SVcCP_M
MERCHANT_UPI_ID=sathya3772-2@okicici
MERCHANT_UPI_NAME=Sathya
WHATSAPP_NUMBER=919788633200
```

*Note: Once Render finishes deploying, it will generate a live URL (e.g., `https://saivi-collection-backend.onrender.com`). Copy this URL for the frontend step.*

---

## 💻 Step 2: Deploy Frontend on Vercel

Vercel hosts the React client app and routes requests to the backend on Render.

### Vercel Configuration Settings:
1. **Import Project:** Select the `saivi-collection` repository on Vercel.
2. **Settings:**
   - **Project Name:** `saivi-collection`
   - **Framework Preset:** `Vite` (Auto-detected)
   - **Root Directory:** `frontend` *(Click Edit and select the `frontend` folder)*
   - **Build and Output Settings:** Keep default settings (`npm run build` and `dist`).

### Environment Variables:
Add the following key-value pair under Environment Variables:
- **Key:** `VITE_API_URL`
- **Value:** `<Your Render Backend URL>` (e.g., `https://saivi-collection-backend.onrender.com`)

Click **Deploy**!

---

## 💾 Image Storage Architecture Note
Images are stored in **Supabase Storage** (inside the `savis-images` bucket).
- Since URLs are stored as absolute paths to Supabase CDN, your images are hosted permanently and **will not be lost** when the Render free tier server restarts.
- Avoid using local fallback on Render's ephemeral disk as those uploads disappear on server restarts.

---
*Created on 2026-07-06.*
