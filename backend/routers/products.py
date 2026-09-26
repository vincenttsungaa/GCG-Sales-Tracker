"""Product catalog (starter decks, accessories, Premium Bandai, other): search, images, sync."""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from lib import product_catalog as pc
from lib.sync_job import SyncJob

router = APIRouter(tags=["products"])


class CatalogProduct(BaseModel):
    id: str
    name: str
    code: str | None = None
    category: str
    release_date: str | None = None
    msrp: str | None = None
    url: str | None = None
    image_url: str


def _out(p: dict) -> CatalogProduct:
    return CatalogProduct(**{**p, "image_url": f"/api/product-images/{p['id']}.webp"})


@router.get("/products", response_model=list[CatalogProduct])
def search_products(
    q: str = Query("", max_length=100),
    category: str | None = Query(None, max_length=30),
    limit: int = Query(60, ge=1, le=200),
):
    """Search the scraped product list by name or code (e.g. "sleeves", "PB01")."""
    return [_out(p) for p in pc.search_products(q, category, limit)]


@router.get("/product-images/{filename}")
def product_image(filename: str):
    """Serve a product image from data/product_images; fetch + store it first if missing."""
    product_id = filename.removesuffix(".webp")
    if not filename.endswith(".webp") or not pc.PRODUCT_ID_RE.match(product_id):
        raise HTTPException(status_code=404, detail="not found")
    product = pc.get_product(product_id)
    if not pc.image_path(product_id).exists() and not (product and pc.download_image(product)):
        raise HTTPException(status_code=404, detail="image not available")
    return FileResponse(
        pc.image_path(product_id),
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=604800"},
    )


job = SyncJob(pc.sync_catalog)


class SyncRequest(BaseModel):
    images: bool = True


@router.get("/products/sync")
def sync_status():
    catalog = pc.load_catalog()
    images = len(list(pc.IMAGE_DIR.glob("*.webp"))) if pc.IMAGE_DIR.exists() else 0
    return {
        **job.state,
        "catalog_count": len(catalog["products"]),
        "synced_at": catalog.get("synced_at"),
        "images_stored": images,
    }


@router.post("/products/sync", status_code=202)
def start_sync(body: SyncRequest | None = None):
    """Re-scrape gundam-gcg.com/en/products (all categories except Booster Pack)."""
    job.start(images=(body or SyncRequest()).images)
    return sync_status()
