"""Card catalog: search, card images, and the sync job that scrapes the official site."""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from lib import card_catalog as cc
from lib.sync_job import SyncJob

router = APIRouter(tags=["cards"])


class CatalogCard(BaseModel):
    id: str
    card_no: str
    name: str
    color: str | None = None
    card_type: str | None = None
    rarity: str | None = None
    set_code: str
    set_name: str | None = None
    product: str | None = None
    parallel: int = 0
    level: str | None = None
    cost: str | None = None
    ap: str | None = None
    hp: str | None = None
    trait: str | None = None
    image_url: str


def _out(card: dict) -> CatalogCard:
    return CatalogCard(**{**card, "image_url": f"/api/card-images/{card['id']}.webp"})


@router.get("/cards", response_model=list[CatalogCard])
def search_cards(
    q: str = Query("", max_length=100),
    set_code: str | None = Query(None, max_length=10),
    limit: int = Query(30, ge=1, le=200),
):
    """Search the scraped catalog by card name or number (e.g. "zock", "ST11-003")."""
    return [_out(c) for c in cc.search_cards(q, set_code, limit)]


@router.get("/cards/sets")
def list_sets():
    """Set codes present in the catalog, in site order, with card counts."""
    counts: dict[str, int] = {}
    for c in cc.load_catalog()["cards"]:
        counts[c["set_code"]] = counts.get(c["set_code"], 0) + 1
    return [{"code": k, "count": v} for k, v in counts.items()]


@router.get("/card-images/{filename}")
def card_image(filename: str):
    """Serve a card image from data/card_images; fetch + store it first if it isn't local yet."""
    if not filename.endswith(".webp"):
        raise HTTPException(status_code=404, detail="not found")
    print_id = filename[: -len(".webp")]
    if not cc.PRINT_ID_RE.match(print_id):
        raise HTTPException(status_code=404, detail="not found")
    if not cc.download_image(print_id):
        raise HTTPException(status_code=404, detail="image not available")
    return FileResponse(
        cc.image_path(print_id),
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=604800"},
    )


# ---- sync job (one at a time, runs in a background thread) ---------------------------

job = SyncJob(cc.sync_catalog)


class SyncRequest(BaseModel):
    images: bool = True


@router.get("/cards/sync")
def sync_status():
    catalog = cc.load_catalog()
    images = len(list(cc.IMAGE_DIR.glob("*.webp"))) if cc.IMAGE_DIR.exists() else 0
    return {
        **job.state,
        "catalog_count": len(catalog["cards"]),
        "synced_at": catalog.get("synced_at"),
        "images_stored": images,
    }


@router.post("/cards/sync", status_code=202)
def start_sync(body: SyncRequest | None = None):
    """Re-scrape gundam-gcg.com (GD01 … Promotion card) into data/cards.json + data/card_images."""
    job.start(images=(body or SyncRequest()).images)
    return sync_status()
