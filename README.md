# 🛡️ SurakshaVahan — Production Multi-School Bus Tracking SaaS

> ⚠️ **IMPORTANT SECURITY NOTICE (Git History & Secret Rotation)**:
> Before deploying this project to a live production environment, rotate any API keys, tokens, or credentials that were previously used during development or testing. If a secret was committed to Git history in an earlier commit, it remains accessible in the repository history. Always generate fresh production credentials (e.g. `JWT_SECRET`, database passwords, SMS/FCM gateway keys) and pass them strictly via environment variables.

SurakshaVahan is a production-grade multi-tenant school bus fleet tracking platform built with React 19, Vite, TypeScript, Express, and Node.js. It features real-time GPS telemetry ingestion, QR badge attendance, automated trip reconciliation, parent notification management, and strict tenant authorization.

---

## 📁 Repository Structure

```
surakshavahan/
├── public/                # Static assets (.htaccess for Hostinger SPA routing)
├── src/
│   ├── client/            # React 19 SPA Frontend (Dashboards, Live Map, Parent Portal)
│   └── server/            # Express REST API, SQLite WAL Persistence, WebSocket Stream
├── tests/                 # Isolated Automated Test Suite
├── server.ts              # Full-Stack Application Entry Point
├── package.json           # Application Dependencies & Scripts
├── .env.example           # Environment Variable Template
└── README.md              # Deployment & Operations Manual
```

---

## 🚀 Part 1: How to Upload This Project to GitHub

### Step 1: Initialize Git Repository Locally
Open your terminal in the project root directory and run:

```bash
# 1. Initialize git
git init

# 2. Add all source files
git add .

# 3. Create initial commit
git commit -m "feat: Initial commit of SurakshaVahan SaaS platform"

# 4. Rename default branch to main
git branch -M main
```

### Step 2: Create a New Repository on GitHub
1. Go to [GitHub](https://github.com/new) and log in.
2. Click **New Repository**.
3. Name your repository `surakshavahan` (or your preferred name).
4. Keep it **Public** or **Private**.
5. **Do NOT** check "Initialize this repository with a README" (we already have one).
6. Click **Create repository**.

### Step 3: Connect Local Repository & Push
Copy the commands provided by GitHub under "or push an existing repository from the command line":

```bash
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/surakshavahan.git
git push -u origin main
```

*(Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username).*

---

## 🌐 Part 2: How to Publish on Hostinger

Hostinger supports two main deployment approaches depending on whether you want to host the **Full-Stack Node.js Server** (VPS / Node Hosting) or the **Static Frontend Web Portal** (Shared Hosting).

---

### Option A: Deploying Full-Stack Node.js Server on Hostinger (Recommended)

Use this method if you want Hostinger to run the Express API, SQLite database, and live WebSocket telemetry stream.

#### Step 1: Create a Node.js Application on Hostinger (VPS or Node.js Hosting)
1. Log in to **Hostinger hPanel**.
2. Navigate to **VPS** or **Node.js Apps**.
3. Create a new application and select **Node.js 20 or 22**.
4. Set the Application Root to `/home/user/htdocs/surakshavahan` (or your app directory).

#### Step 2: Connect Git Repository or Upload Files
In Hostinger hPanel Git Deployment or via SSH terminal:
```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/surakshavahan.git .
npm install
```

#### Step 3: Configure Environment Variables
Create a `.env` file in the root directory on Hostinger:
```ini
NODE_ENV=production
PORT=3000
JWT_SECRET=your_secure_random_base64_secret_key_minimum_32_chars_long
JWT_EXPIRES_IN=2h
SEED_SAMPLE_DATA=false
SQLITE_DB_PATH=data/schoolbus.db
```
*(Generate a strong secret key using `openssl rand -base64 32` in your local terminal).*

#### Step 4: Build and Start
```bash
# Build frontend static assets
npm run build

# Start production server using tsx or PM2
npx pm2 start server.ts --name "surakshavahan" --interpreter npx -- tsx
npx pm2 save
```

---

### Option B: Deploying Static Web Portal on Hostinger Shared Hosting (hPanel)

Use this method if you only want to deploy the compiled React SPA frontend to Hostinger's standard Web Hosting (`public_html`).

#### Step 1: Build the Production Frontend
On your local machine or GitHub Actions:
```bash
npm run build
```
This generates a `dist/` directory containing all optimized HTML, JavaScript, CSS, and the `.htaccess` file.

#### Step 2: Upload to Hostinger `public_html`
1. Log in to **Hostinger hPanel**.
2. Open **File Manager** for your domain.
3. Navigate to `public_html`.
4. Upload all files from inside your local `dist/` folder directly into `public_html/`.

#### Step 3: Verify Single-Page Application (SPA) Routing
The `.htaccess` file included in the build automatically handles client-side routing on Hostinger's Apache servers. Direct visits or page refreshes on `/login`, `/dashboard`, or `/parent-portal` will load seamlessly without returning 404 errors.

---

## 🛠️ Local Development & Testing Commands

```bash
# Start local full-stack development server
npm run dev

# Run TypeScript static type checking
npm run lint

# Run automated verification test suite
npm test

# Build production web bundle
npm run build
```

---

## 🔒 Production Invariants & Security
* **Environment Isolation**: `.env` and SQLite database files (`data/*.db`) are ignored in `.gitignore` to protect sensitive records.
* **JWT Entropy Enforcement**: Requires minimum 32 characters with Shannon entropy $\ge 3.4$ in production.
* **SPA Rewrite Rule**: `.htaccess` included in `/public` for instant Hostinger Apache integration.
