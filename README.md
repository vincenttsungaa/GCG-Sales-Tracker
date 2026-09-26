# Gundam Card Game Sales Tracker

An app for tracking a Gundam Card Game Sales. It has two parts:

- **`backend/`**: the Python server
- **`frontend/`**: the web interface, a Node.js app

Some files are not included in this repository on purpose: the Python virtual environment (`venv`), the Node packages (`node_modules`), cache files (`__pycache__`) and the `.env` file with private settings. You'll create these yourself in the steps below. It only takes a few minutes.

## Requirements

Install these first:

- [Git](https://git-scm.com/downloads)
- [Python](https://www.python.org/downloads/) 3.14 (the version this project was built with). During installation on Windows, tick **"Add Python to PATH"**.
- [Node.js](https://nodejs.org/) (the LTS version), which includes `npm`

Check they're installed:

```bash
git --version
python --version
node --version
npm --version
```

## 1. Clone the repository

```bash
git clone https://github.com/vincenttsungaa/GCG-Sales-Tracker.git
```

## 2. Set up the backend (one time only)

```bash
cd GCG-Sales-Tracker/backend
python -m venv venv
```

Activate the virtual environment with the command for your terminal:

| Terminal | Command |
|---|---|
| Git Bash (Windows) | `source venv/Scripts/activate` |
| Command Prompt (Windows) | `venv\Scripts\activate` |
| PowerShell (Windows) | `venv\Scripts\Activate.ps1` |
| macOS / Linux | `source venv/bin/activate` |

When it's active, your prompt starts with `(venv)`. Then install the dependencies:

```bash
pip install -r requirements.txt
```

Create your `.env` file by copying the example:

```bash
cp .env.example .env        # Command Prompt: copy .env.example .env
```

Open `.env` and fill in your own values. Don't commit it, because it holds private settings.

Download the card and product databases (every card from GD01 to the Promotion cards, and every product except booster packs, with images) from the official site:

```bash
python scrape_cards.py
```

This saves `data/cards.json` + `data/card_images/` (about 2,000 cards, ~110 MB) and `data/products.json` + `data/product_images/`. It takes a few minutes. Run it again whenever new sets or products come out — images you already have are skipped. Use `--cards-only` or `--products-only` to refresh just one. You can also do this from the app: **Add Card** or **Add Item → Update database**.

(Optional) Add sample data:

```bash
python seed.py
```

## 3. Set up the frontend (one time only)

From the main project folder:

```bash
cd frontend
npm install
```

This downloads everything listed in `package.json` into a new `node_modules` folder. It can take a minute or two.

## 4. Run the app

The backend and frontend run at the same time, so you need **two terminal windows**.

**Terminal 1: backend**

```bash
cd GCG-Sales-Tracker/backend
source venv/Scripts/activate     # or the command for your terminal from step 2
python server.py
```

The backend runs at `http://127.0.0.1:8001`. Leave this window open. To see and try the API endpoints, visit `http://127.0.0.1:8001/docs`.

**Terminal 2: frontend**

```bash
cd GCG-Sales-Tracker/frontend
npm run dev
```

The frontend terminal shows a local address, usually `http://localhost:3000`. Open it in your browser to use the app.

To stop either one, press `Ctrl + C` in its terminal.

## Running it again later

The setup only needs to be done once. Next time, just repeat step 4.

If someone adds new packages later, update after pulling changes:

```bash
git pull
cd backend && pip install -r requirements.txt     # with the venv active
cd ../frontend && npm install
```

## Running the tests

With the virtual environment active, from the `backend` folder.
The backend must already be running in another terminal. The tests
use the database in your `.env`, and each test removes its own
test items afterwards.

```bash
pytest
```

## Troubleshooting

- **`python: command not found`**: Python isn't installed or isn't on your PATH. Reinstall it with "Add Python to PATH" ticked, or try `py` instead of `python`.
- **`npm: command not found`**: Node.js isn't installed. Install it, then close and reopen your terminal.
- **`ModuleNotFoundError`**: the virtual environment isn't active, or the dependencies aren't installed. Activate it (step 2) and run `pip install -r requirements.txt` again.
- **PowerShell says running scripts is disabled**: run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then try activating again.
- **The page loads but shows no data or network errors**: make sure the backend is running in the other terminal.
- **Errors about missing settings or keys**: check that `.env` exists in the `backend` folder and all values are filled in.
