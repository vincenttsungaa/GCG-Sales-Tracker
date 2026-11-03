import asyncio
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, APIRouter, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import mimetypes
from pathlib import Path


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import client, ensure_indexes
from lib.dates import today_iso
from routers.items import router as items_router
from routers.cards import router as cards_router
from routers.products import router as products_router
from routers.stacks import router as stacks_router
from routers.auth import router as auth_router
from routers.admin import router as admin_router
from routers.bmc import router as bmc_router
from lib.auth import current_user
from lib.membership import reminder_loop


# Startup runs before the yield, shutdown after it. Add your own setup/teardown here.
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.index_task = asyncio.create_task(ensure_indexes())  # background: a big index build must not block boot
    app.state.reminders = asyncio.create_task(reminder_loop())  # emails members 5 days before their membership ends
    yield
    app.state.reminders.cancel()
    client.close()


# The live site (COOKIE_SECURE=true, served over https): the API's /docs pages are off, and the browser checks below apply
PRODUCTION = os.environ.get("COOKIE_SECURE", "").lower() in ("1", "true", "yes")

# Create the main app without a prefix
app = FastAPI(lifespan=lifespan, docs_url=None if PRODUCTION else "/docs", redoc_url=None, openapi_url=None if PRODUCTION else "/openapi.json")

MAX_BODY = 3 * 1024 * 1024  # the largest thing sent is a listing with a photo (~600 KB) or an export of every listing
ALLOWED_ORIGINS = {
    o.strip().rstrip("/") for o in (os.environ.get("CORS_ORIGINS", "") + "," + os.environ.get("APP_URL", "")).split(",") if o.strip()
}
# what the website itself may load: its own files, Google Fonts, card pictures from anywhere (https), your photos (data:/blob:)
CSP_PAGE = (
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; worker-src 'self' blob:; "
    "manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)
CSP_SVG = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"  # pictures the server draws


@app.middleware("http")
async def security(request: Request, call_next):
    """Every response: browser safety headers. Every change (POST, PUT, PATCH, DELETE): not too large, and on the live
    site only from CardStakk's own pages (another site can't make your browser change your account). Buy Me a
    Coffee's webhook comes from its servers, checked by its signature instead."""
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        size = request.headers.get("content-length", "")
        if size.isdigit() and int(size) > MAX_BODY:
            return JSONResponse(status_code=413, content={"detail": "That's too large to send."})
        origin = (request.headers.get("origin") or "").rstrip("/")
        if PRODUCTION and origin and origin not in ALLOWED_ORIGINS and not request.url.path.startswith("/api/bmc/"):
            return JSONResponse(status_code=403, content={"detail": "Request blocked."})
    response = await call_next(request)
    h = response.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=()")
    kind = h.get("content-type", "")
    if kind.startswith("image/svg+xml"):
        h.setdefault("Content-Security-Policy", CSP_SVG)
    elif PRODUCTION and kind.startswith("text/html"):
        h.setdefault("Content-Security-Policy", CSP_PAGE)
    return response

# A 422 says where and why, without repeating the input back (FastAPI's default sends the whole
# value: a 600 KB photo, or the password someone typed)
@app.exception_handler(RequestValidationError)
async def _validation_error(request: Request, exc: RequestValidationError):
    errors = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors)})


# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    """Health check — confirms the API is up."""
    return {"status": "ok"}

@api_router.get("/today")
async def get_today():
    """Today's date in APP_TZ — the client anchors deal-date defaults here, never local clock math."""
    return {"today": today_iso()}


# Fold resource routers into /api, then mount everything on the app
# listings and Stakks: signed-in users only, each sees just their own (lib/auth.py)
signed_in = [Depends(current_user)]
api_router.include_router(auth_router)
api_router.include_router(admin_router)  # site owner only
api_router.include_router(bmc_router)  # Buy Me a Coffee webhook (signed)
api_router.include_router(items_router, dependencies=signed_in)
api_router.include_router(stacks_router, dependencies=signed_in)
# the card / product databases are public (catalog data); updating them is for the site owner
api_router.include_router(cards_router)
api_router.include_router(products_router)
app.include_router(api_router)

# Production: the built frontend (frontend/dist, from `npm run build`) is served from here too, so the site
# is one process behind Cloudflare. In development Vite serves it instead and this folder doesn't exist.
DIST = (ROOT_DIR.parent / "frontend" / "dist").resolve()
if DIST.is_dir():
    mimetypes.add_type("application/manifest+json", ".webmanifest")

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str):
        if path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        file = (DIST / path).resolve()
        if path and file.is_file() and DIST in file.parents:
            # build files have a hash in their name and never change; everything else is checked each time
            hashed = path.startswith("assets/")
            return FileResponse(file, headers={"Cache-Control": "public, max-age=31536000, immutable" if hashed else "no-cache"})
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})  # the app's own pages (/support, …)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=os.environ.get('CORS_ORIGINS', 'http://localhost:3000').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8001, reload=True, reload_excludes=["venv"])