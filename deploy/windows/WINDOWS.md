# Running the live site on a Windows PC (or laptop)

CardStakk runs on this computer, and Cloudflare Tunnel connects it to `cardstakkgcgsalestracker.com`. No card and no open ports are needed.

The site is only up while the computer is on, awake and logged in.

```
visitor ──https──▶ Cloudflare ──tunnel──▶ this PC: CardStakk on 127.0.0.1:8002 ──▶ MongoDB Atlas
```

The live copy lives in **its own folder**, separate from the one you develop in, and runs on **port 8002**. Editing, testing or restarting your development copy (port 8001) never touches the live site. New code only goes live when you push it to GitHub and run `update.bat`.

## 1. Make the live copy

In Git Bash:

```bash
cd /c
git clone https://github.com/vincenttsungaa/GCG-Sales-Tracker.git CardStakk
```

Then in **Command Prompt**:

```bat
cd C:\CardStakk
deploy\windows\setup.bat
```

This makes the Python environment, installs everything and builds the website. It needs Python 3.14 and Node.js, the same ones you already use.

## 2. Live settings: `C:\CardStakk\backend\.env`

1. Copy your development `backend\.env` over it.
2. Then change or add these lines:

```
APP_URL=https://cardstakkgcgsalestracker.com
CORS_ORIGINS=https://cardstakkgcgsalestracker.com
COOKIE_SECURE=true
TRUST_CLOUDFLARE=true
```

Keep `MONGO_URL` and `DB_NAME` as they are. Your real listings are in that database.

## 3. Start it

```bat
deploy\windows\start.bat
```

A window called **CardStakk live** opens. Minimise it, but don't close it. To check it's working, open http://127.0.0.1:8002 in your browser.

**Start it with Windows:**
1. Press Win+R, type `shell:startup` and press Enter.
2. In that folder, right-click → **New → Shortcut**.
3. For the location, enter `C:\CardStakk\deploy\windows\start.bat`.
4. Optional: in the shortcut's Properties, set **Run: Minimized**.

## 4. Connect the domain (Cloudflare Tunnel)

1. In the Cloudflare dashboard, go to **Zero Trust → Networks → Tunnels → Create a tunnel** and choose **Cloudflared**. Name it `cardstakk`.
2. Choose **Windows**. Download and install cloudflared as shown.
3. Copy the `cloudflared.exe service install …` command and run it in **Command Prompt as administrator**.
   - This makes the tunnel a Windows service, so it starts by itself with the PC.
   - The tunnel then shows as **Healthy**.
4. Add the route. It's called a **Public hostname** or **Published application route**:
   - **Domain:** `cardstakkgcgsalestracker.com` (subdomain and path empty)
   - **Service:** `HTTP` → `localhost:8002`
5. In the domain's **SSL/TLS → Edge Certificates**, turn on **Always Use HTTPS**.


## 5. Keep the computer awake

1. Go to **Settings → System → Power** (on some PCs, **Power & battery**).
2. Set **Sleep** (when plugged in) to **Never**.
3. The screen can still turn off.

On a laptop, also set **closing the lid** to **Do nothing** when plugged in. You'll find it in Control Panel → Power Options → "Choose what closing the lid does".

## Daily database backup

The free Atlas cluster keeps no backups, so CardStakk saves its own copy to `backend\backups` (the newest 30 are kept).

**Once now,** to check it works:

```bat
cd %USERPROFILE%\Downloads\CardStakk
deploy\windows\backup.bat
```

It prints `Saved cardstakk-….json.gz: … users, … items, …`.

**Every day at 3 am,** in Command Prompt:

```bat
schtasks /create /tn "CardStakk backup" /sc daily /st 03:00 /tr "\"%USERPROFILE%\Downloads\CardStakk\deploy\windows\backup.bat\""
```

It runs while you're logged in and the PC is on, the same as the site itself.

**Keep a copy somewhere else** now and then, such as a private Google Drive folder. If this PC fails, its backups go with it.

The files hold members' emails and password hashes, so never share them.

**To put a backup back** (replaces what's in the database; it saves the current state first and asks you to type `restore`):

```bat
cd %USERPROFILE%\Downloads\CardStakk\backend
venv\Scripts\python backup_db.py restore backups\cardstakk-2026-11-03-030000.json.gz
```

## Updating the live site

1. Push to GitHub from your development folder.
2. Then, in Command Prompt:

```bat
cd C:\CardStakk
deploy\windows\update.bat
```

It pulls, builds and restarts the CardStakk live window.

## Moving it to another computer (e.g. your laptop)

Nothing on the website or in Cloudflare changes. The database is online (Atlas) and the photos are in GitHub, so only this setup moves.

**On the laptop:**
1. Install Git, Python 3.14 and Node.js.
2. Do steps 1–3 above, copying `C:\CardStakk\backend\.env` from the PC.

**Move the tunnel to the laptop:**
1. Cloudflare dashboard → your `cardstakk` tunnel → **Configure**. Under the Windows install steps it shows the same `cloudflared.exe service install …` command.
2. Run that command on the laptop, as administrator. The laptop joins the **same tunnel**, so no new route is needed.

**Retire the PC:**
1. Run `cloudflared.exe service uninstall` as administrator.
2. Close its CardStakk live window, and remove its startup shortcut.

**Atlas:** if the laptop will be on a different network than the PC, add that network's IP in **Network Access**.

While both computers are connected to the tunnel, Cloudflare shares visitors between them. That's harmless for a few minutes during the move, but don't leave both on.
