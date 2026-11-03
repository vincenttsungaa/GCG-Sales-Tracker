# Putting CardStakk online

No card for Oracle? Run it on your own Windows PC or laptop instead: see [windows/WINDOWS.md](windows/WINDOWS.md).

How it fits together:

- One small Oracle Cloud server runs the backend. The backend also serves the built frontend.
- Cloudflare Tunnel connects the server to `cardstakkgcgsalestracker.com`.
- The database stays on MongoDB Atlas. Emails go through Resend.

The server has no open ports apart from SSH. Visitors only ever reach Cloudflare, which handles HTTPS, hides the server's address.

```
visitor ──https──▶ Cloudflare ──tunnel──▶ server: CardStakk on 127.0.0.1:8001 ──▶ MongoDB Atlas
```

## 0. Before you start (on your PC)

Commit and push everything, the product photos included. The server gets the code from GitHub.

## 1. Create the server (Oracle Cloud)

1. Sign up at cloud.oracle.com.
   - The **home region** can't be changed later. Pick **Australia East (Sydney)** or **Australia Southeast (Melbourne)**.
   - Oracle checks your card but doesn't charge for Always Free resources.
2. Go to **Compute → Instances → Create instance**.
   - **Image:** Ubuntu 24.04.
   - **Shape:** **Ampere A1.Flex** with 1 OCPU and 6 GB memory (Always Free).
     If it says "out of capacity", use **VM.Standard.E2.1.Micro** (also Always Free, 1 GB). The setup adds swap for it.
   - **SSH keys:** choose "Generate a key pair" and **download the private key**. You need it to log in.
   - **Networking:** leave the defaults. Only SSH (port 22) is open, and that's all CardStakk needs.
3. Note the instance's **public IP address**.

Oracle can reclaim Always Free servers that sit nearly idle for a week. To avoid that, upgrade the account to **Pay As You Go** (Billing → Upgrade). Always Free resources stay free.

## 2. Log in and install

From your PC (Git Bash or PowerShell), using the key you downloaded:

```bash
ssh -i path/to/the-key.key ubuntu@<public IP>
```

On the server:

```bash
git clone https://github.com/vincenttsungaa/GCG-Sales-Tracker.git
cd GCG-Sales-Tracker
bash deploy/setup.sh
```

If the repository is private, GitHub asks for a username and a password. Use a **personal access token** as the password: GitHub → Settings → Developer settings → Fine-grained tokens, read-only access to this repository.

## 3. Settings: `backend/.env`

```bash
nano backend/.env
```

1. Copy the values from your PC's `backend/.env`: MONGO_URL, DB_NAME, the SMTP lines, CLAIM_EMAIL, ADMIN_EMAILS, FEEDBACK_EMAIL, PERKS_EMAILS and BMC_WEBHOOK_SECRET.
2. Then set these for the live site:

```
APP_URL=https://cardstakkgcgsalestracker.com
CORS_ORIGINS=https://cardstakkgcgsalestracker.com
COOKIE_SECURE=true
TRUST_CLOUDFLARE=true
APP_TZ=Australia/Sydney
```

3. Save with Ctrl+O, Enter, then exit with Ctrl+X.

## 4. Let the server reach the database (MongoDB Atlas)

In Atlas, go to **Network Access → Add IP Address** and enter the server's public IP.

## 5. Start it

```bash
bash deploy/update.sh
```

It builds the frontend, starts CardStakk and ends with **"CardStakk is running."** The first build takes a few minutes.

## 6. Connect the domain (Cloudflare Tunnel)

1. In the Cloudflare dashboard, go to **Zero Trust → Networks → Tunnels → Create a tunnel** and choose **Cloudflared**. Name it `cardstakk`.
2. Pick **Debian**, with the architecture of your server:
   - **arm64** for Ampere A1.
   - **64-bit** for E2.1.Micro.
3. Copy the install command it shows and run it on the server. The tunnel shows as **Healthy**.
4. Add the route. It's called a **Public hostname** or **Published application route**:
   - **Domain:** `cardstakkgcgsalestracker.com` (subdomain empty, path empty)
   - **Service:** `HTTP` → `localhost:8001`
5. In the domain's **SSL/TLS → Edge Certificates**, turn on **Always Use HTTPS**.

Open https://cardstakkgcgsalestracker.com and CardStakk loads.


## 7. Check everything

1. **Site:** sign up with a real email, confirm it from the email, and log out and back in.
2. **Buy Me a Coffee:** on the webhook page, click **Send test event**. `journalctl -u cardstakk -n 20` should show "BMC test event … received and verified".
3. **Emails:** the confirm and reset links should open `https://cardstakkgcgsalestracker.com`.

## Updating the live site later

1. Push from your PC.
2. On the server:

```bash
cd GCG-Sales-Tracker && bash deploy/update.sh
```

## Handy commands (on the server)

| What | Command |
|---|---|
| See the log, live | `journalctl -u cardstakk -f` |
| Restart | `sudo systemctl restart cardstakk` |
| Is it running? | `systemctl status cardstakk` |
| Download every card image in advance (optional; otherwise each is fetched the first time it's shown) | `cd backend && venv/bin/python scrape_cards.py` |
| Run an owner script (e.g. `set_founding.py`) | `cd backend && venv/bin/python set_founding.py someone@example.com` |
