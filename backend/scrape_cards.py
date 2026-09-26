"""Scrape the Gundam Card Game card list and product list into backend/data/.

    python scrape_cards.py                  # cards + products, with images (existing images are skipped)
    python scrape_cards.py --cards-only     # just the card database
    python scrape_cards.py --products-only  # just the product database (Add Item)
    python scrape_cards.py --no-images      # catalogs only (images are then fetched on first view)

Covers every package on https://www.gundam-gcg.com/en/cards/ — GD01 … Promotion card —
including parallel ("_pN") printings. Writes data/cards.json and data/card_images/*.webp.
Products come from https://www.gundam-gcg.com/en/products/list.php (every category except
Booster Pack) into data/products.json and data/product_images/*.webp.
The "Update" links in Add Card / Add Item run the same code.
"""

import argparse
import logging
import sys

from lib import card_catalog, product_catalog


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--no-images", action="store_true", help="skip downloading card images")
    parser.add_argument("--workers", type=int, default=8, help="parallel requests (default 8)")
    only = parser.add_mutually_exclusive_group()
    only.add_argument("--cards-only", action="store_true", help="only refresh the card database")
    only.add_argument("--products-only", action="store_true", help="only refresh the product database")
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)

    last = {"stage": None}

    def progress(stage: str, done: int, total: int) -> None:
        if stage != last["stage"]:
            if last["stage"]:
                print()
            last["stage"] = stage
        print(f"\r  {stage:<9} {done}/{total}", end="", flush=True)

    if not args.products_only:
        print("Scraping cards from gundam-gcg.com …")
        result = card_catalog.sync_catalog(images=not args.no_images, workers=args.workers, progress=progress)
        print(f"\n{result['count']} cards saved to {card_catalog.CATALOG_PATH}")
        if not args.no_images:
            print(f"Card images stored in {card_catalog.IMAGE_DIR}")
        if result["failed"]:
            print(f"{len(result['failed'])} cards could not be read: {', '.join(result['failed'][:20])}")
        last["stage"] = None

    if not args.cards_only:
        print("\nScraping products (everything except booster packs) …")
        result = product_catalog.sync_catalog(images=not args.no_images, progress=progress)
        print(f"\n{result['count']} products saved to {product_catalog.CATALOG_PATH}")
        if not args.no_images:
            print(f"Product images stored in {product_catalog.IMAGE_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
