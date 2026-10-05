"""Product catalog (starter decks, accessories, Premium Bandai, other): search, images, sync."""

import re

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from lib import card_catalog as cc
from lib import product_catalog as pc
from lib.sync_job import SyncJob

router = APIRouter(tags=["products"])


class Edition(BaseModel):
    name: str
    msrp: str | None = None


class ResourceCard(BaseModel):
    card_no: str  # e.g. "RP-025"
    name: str | None = None
    image_url: str


class AltArtCard(BaseModel):
    id: str  # print id in the card database, e.g. "ST02-010_p4"
    card_no: str  # number printed on the card, e.g. "ST02-010"
    name: str | None = None
    image_url: str


class SleeveDesign(BaseModel):
    id: str  # e.g. "efsf", "storage-box", "rp-011"
    name: str  # e.g. "Gundam/EFSF", "Storage Box", "RP-011"
    image_url: str  # just that piece
    fit: str = "cover"  # "contain" for pieces that aren't card-shaped (boxes, playmats)


class CatalogProduct(BaseModel):
    id: str
    name: str
    code: str | None = None
    category: str
    release_date: str | None = None
    msrp: str | None = None
    editions: list[Edition] = []  # e.g. Regular Version / Special Edition (ST01–ST04)
    parts: list[str] = []  # e.g. Storage Box, Sleeves, Playmat … (PB01, PB02)
    resource_cards: list[ResourceCard] = []  # shown when the "Resources" part is picked
    part_images: dict[str, str] = {}  # part → photo, e.g. {"Playmat": "/api/product-images/pb01-part-playmat.svg"}
    alt_art_cards: list[AltArtCard] = []  # shown when the "Alt-Art Cards" part is picked (PB01)
    resource_set_image_url: str | None = None  # picture of the whole resource set (used for Resources listings)
    # picture of a bundle of parts: add ?parts=storage-box,playmat&cards=RP-024,ST02-010_p4
    bundle_image_url: str | None = None
    sleeve_designs: list[SleeveDesign] = []  # sleeve designs / set contents to pick from
    sleeve_label: str | None = None  # the picker's heading: "Sleeve designs" or "Set contents"
    sleeve_set_image_url: str | None = None  # add ?designs=logo,efsf for a picture of just those sleeves
    url: str | None = None
    image_url: str


def _out(p: dict) -> CatalogProduct:
    # products.json from before editions were parsed: derive them from the MSRP text.
    editions = p.get("editions") or pc.parse_editions(p.get("msrp"))
    opts = pc.product_options(p["id"])
    resource_cards = []
    for card_no in opts["resource_cards"]:
        card = cc.get_card(card_no)  # base printing in the card database, if downloaded
        resource_cards.append(
            ResourceCard(
                card_no=card_no,
                name=card["name"] if card else None,
                image_url=f"/api/card-images/{card_no}.webp",
            )
        )
    alt_art_cards = []
    for print_id in opts["alt_art_cards"]:
        card = cc.get_card(print_id)  # the PB01 printing in the card database, if downloaded
        alt_art_cards.append(
            AltArtCard(
                id=print_id,
                card_no=card["card_no"] if card else print_id.split("_")[0],
                name=card["name"] if card else None,
                image_url=f"/api/card-images/{print_id}.webp",
            )
        )
    return CatalogProduct(
        **{
            **p,
            "name": pc.code_first(p["name"]),  # products.json saved before names led with the code
            "editions": editions,
            "parts": opts["parts"],
            "resource_cards": resource_cards,
            "alt_art_cards": alt_art_cards,
            "resource_set_image_url": f"/api/product-images/{p['id']}-resources.svg" if resource_cards else None,
            "part_images": pc.part_photo_urls(p["id"]),
            "bundle_image_url": f"/api/product-images/{p['id']}-bundle.svg" if opts["parts"] else None,
            "sleeve_designs": pc.sleeve_designs(p["id"]),
            "sleeve_label": pc.sleeve_label(p["id"]),
            "sleeve_set_image_url": f"/api/product-images/{p['id']}-sleeves.svg" if pc.sleeve_designs(p["id"]) else None,
            "image_url": f"/api/product-images/{p['id']}.webp",
        }
    )


@router.get("/products", response_model=list[CatalogProduct])
def search_products(
    q: str = Query("", max_length=100),
    category: str | None = Query(None, max_length=30),
    limit: int = Query(60, ge=1, le=200),
):
    """Search the scraped product list by name or code (e.g. "sleeves", "PB01")."""
    return [_out(p) for p in pc.search_products(q, category, limit)]


@router.get("/product-images/{filename}")
def product_image(
    filename: str,
    cards: str | None = Query(None, max_length=2000),
    designs: str | None = Query(None, max_length=200),
    parts: str | None = Query(None, max_length=400),
):
    """Serve a product image from data/product_images; fetch + store it first if missing.

    "<id>-resources.svg?cards=RP-025,RP-027" is a picture of just those resource cards
    (all of the set's resource cards when `cards` is left out).
    "<id>-sleeves.svg?designs=logo,efsf" is a picture of just those sleeve designs.
    """
    part_match = re.fullmatch(r"([a-z0-9-]+?)-part-([a-z0-9-]+)\.svg", filename)
    if part_match:
        path = pc.ensure_part_photo(part_match.group(1), part_match.group(2))
        if not path:
            raise HTTPException(status_code=404, detail="no photo for this part")
        # no-cache: browsers re-check (cheap, via ETag) so a changed photo or crop shows at once
        return FileResponse(path, media_type="image/svg+xml", headers={"Cache-Control": "no-cache"})
    if filename.endswith("-bundle.svg"):
        product_id = filename.removesuffix("-bundle.svg")
        slugs = [s.strip().lower() for s in (parts or "").split(",") if s.strip()]
        codes = [c.strip().upper().replace("_P", "_p") for c in (cards or "").split(",") if c.strip()]
        path = pc.ensure_bundle_image(product_id, slugs, codes) if pc.PRODUCT_ID_RE.match(product_id) else None
        if not path:
            raise HTTPException(status_code=404, detail="nothing to show for this bundle")
        return FileResponse(path, media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=86400"})
    if filename.endswith("-sleeves.svg"):
        product_id = filename.removesuffix("-sleeves.svg")
        picked = [d.strip().lower() for d in (designs or "").split(",") if d.strip()]
        path = pc.ensure_sleeve_image(product_id, picked) if pc.PRODUCT_ID_RE.match(product_id) else None
        if not path:
            raise HTTPException(status_code=404, detail="no such sleeve designs")
        return FileResponse(path, media_type="image/svg+xml", headers={"Cache-Control": "no-cache"})
    if filename.endswith("-resources.svg"):
        product_id = filename.removesuffix("-resources.svg")
        # print ids keep their lowercase parallel suffix: "st02-010_P4" → "ST02-010_p4"
        selected = [c.strip().upper().replace("_P", "_p") for c in cards.split(",") if c.strip()] if cards else None
        path = pc.ensure_resource_set_image(product_id, selected) if pc.PRODUCT_ID_RE.match(product_id) else None
        if not path:
            raise HTTPException(status_code=404, detail="no resource set for this product")
        return FileResponse(path, media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=86400"})
    product_id = filename.removesuffix(".webp")
    if not filename.endswith(".webp") or not pc.PRODUCT_ID_RE.match(product_id):
        raise HTTPException(status_code=404, detail="not found")
    product = pc.get_product(product_id)
    if not pc.image_path(product_id).exists() and not (product and pc.download_image(product)):
        raise HTTPException(status_code=404, detail="image not available")
    return FileResponse(
        pc.image_path(product_id),
        media_type="image/webp",
        headers={"Cache-Control": "no-cache"},  # revalidated, so a replaced photo shows up right away
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
