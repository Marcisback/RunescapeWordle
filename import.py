import json
import re
from pathlib import Path

import requests

# ============ CONFIG ============

# We still use OSRSBox for icons (ID-based PNGs)
OSRSBOX_BASE_URL = "https://www.osrsbox.com/osrsbox-db"
ICON_URL_TEMPLATE = OSRSBOX_BASE_URL + "/items-icons/{id}.png"

# Local items-complete.json (downloaded once from GitHub)
# Download with:
#   curl -L https://raw.githubusercontent.com/0xNeffarion/osrsreboxed-db/master/docs/items-complete.json -o items-complete.json
LOCAL_ITEMS_COMPLETE = Path("items-complete.json")

# OSRS Wiki real-time prices API
GE_LATEST_URL = "https://prices.runescape.wiki/api/v1/osrs/latest"

# Identify yourself per the API guidelines
USER_AGENT = "YourName-OSRSItemGame/1.0 (your-email@example.com)"  # <-- change this

OUTPUT_PATH = Path("osrs_game_items.json")

# ================================


def normalize_item_name(name: str) -> str:
    """
    Normalize item names for the game.
    - Remove trailing dose suffix like (4), (3), (2), (1)
    - Remove (unf), (mix) variants
    """
    # Strip trailing (number), with or without preceding space
    name = re.sub(r"\s*\(\d+\)$", "", name)

    # Strip "(unf)", "(mix)" (case-insensitive, with optional space)
    name = re.sub(r"\s*\((unf|mix)\)$", "", name, flags=re.IGNORECASE)

    return name.strip()


def download_items_complete():
    """
    Load the full OSRS item database from a local items-complete.json file.

    Download it first with:
      curl -L https://raw.githubusercontent.com/0xNeffarion/osrsreboxed-db/master/docs/items-complete.json -o items-complete.json
    """
    if not LOCAL_ITEMS_COMPLETE.exists():
        raise FileNotFoundError(
            f"{LOCAL_ITEMS_COMPLETE} not found.\n"
            "Download it with:\n"
            "  curl -L https://raw.githubusercontent.com/0xNeffarion/osrsreboxed-db/master/docs/items-complete.json "
            "-o items-complete.json"
        )

    print(f"Loading full item database from {LOCAL_ITEMS_COMPLETE.resolve()} ...")
    with LOCAL_ITEMS_COMPLETE.open("r", encoding="utf-8") as f:
        data = json.load(f)

    # items-complete.json can be a dict keyed by string item id
    # or a list of item dicts depending on version.
    if isinstance(data, dict):
        items = list(data.values())
    elif isinstance(data, list):
        items = data
    else:
        raise TypeError("Unexpected JSON structure for items-complete.json")

    print(f"Loaded {len(items)} total items from local JSON.")
    return items


def filter_items_tradeable_nonquest(items):
    """
    Filter items to:
      - tradeable == True
      - quest_item == False

    Also:
      - normalize the 'name'
      - attach a normalized 'slot' field using item_slot (if present)
    """
    filtered = []
    for item in items:
        item_id = item.get("id")
        name = item.get("name")
        if item_id is None or not name:
            continue

        # Normalize name (strip doses and (unf)/(mix) etc.)
        name = normalize_item_name(name)

        tradeable = item.get("tradeable", False)
        quest_item = item.get("quest_item", False)

        if not tradeable:
            continue
        if quest_item:
            continue

        slot = item.get("item_slot") or "none"
        release_date = item.get("release_date")  # can be None

        filtered.append(
            {
                "id": item_id,
                "name": name,
                "slot": slot,
                "tradeable": bool(tradeable),
                "release_date": release_date,
            }
        )

    print(f"Filtered to {len(filtered)} tradeable, non-quest items (before icon check/dedupe).")
    return filtered


def fetch_ge_latest():
    """
    Fetch the real-time GE price snapshot from the OSRS Wiki price API.
    Returns a dict: { item_id (int): high_price (int or None), ... }
    """
    print(f"Fetching latest GE prices from {GE_LATEST_URL} ...")
    headers = {"User-Agent": USER_AGENT}
    resp = requests.get(GE_LATEST_URL, headers=headers, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    prices = {}
    raw = data.get("data", {})
    for id_str, info in raw.items():
        try:
            item_id = int(id_str)
        except ValueError:
            continue
        # You can use "high", "low", or compute an average; here we use "high".
        prices[item_id] = info.get("high")

    print(f"Loaded GE prices for {len(prices)} items.")
    return prices


def icon_exists(url: str) -> bool:
    """
    Check if an icon exists at the given URL.
    Uses HEAD for speed; falls back gracefully on errors.
    """
    try:
        resp = requests.head(url, timeout=3)
        return resp.status_code == 200
    except requests.RequestException:
        return False


def dedupe_by_name(items):
    """
    Deduplicate items by their normalized 'name'.

    If multiple items share the same name (e.g. potion doses),
    keep the one with the highest ge_price (if available),
    otherwise keep the first encountered.
    """
    best_by_name = {}

    for item in items:
        name = item["name"]
        existing = best_by_name.get(name)

        if existing is None:
            best_by_name[name] = item
        else:
            def price_val(it):
                return it.get("ge_price") or 0

            if price_val(item) > price_val(existing):
                best_by_name[name] = item

    deduped = list(best_by_name.values())
    print(f"Deduped down to {len(deduped)} unique item names.")
    return deduped


def build_game_items():
    """
    Combine structured OSRS item data with GE prices into a single list
    ready for your game. Only keep items whose icons actually exist.
    """
    all_items = download_items_complete()
    filtered_items = filter_items_tradeable_nonquest(all_items)
    prices = fetch_ge_latest()

    game_items_raw = []

    print("Checking which items have working icons...")
    for idx, item in enumerate(filtered_items, start=1):
        item_id = item["id"]
        icon_url = ICON_URL_TEMPLATE.format(id=item_id)

        if not icon_exists(icon_url):
            # Skip items whose icon doesn't exist on OSRSBox
            continue

        game_items_raw.append(
            {
                "id": item_id,
                "name": item["name"],
                "icon": icon_url,
                "slot": item["slot"],
                "tradeable": item["tradeable"],
                "release_date": item["release_date"],  # from items-complete.json
                "ge_price": prices.get(item_id),       # may be None if not in price API
            }
        )

        if idx % 500 == 0:
            print(f"  processed {idx} items... (current kept: {len(game_items_raw)})")

    print(f"Remaining items with working icons: {len(game_items_raw)}")

    # Deduplicate by item name (to collapse potion doses etc.)
    game_items = dedupe_by_name(game_items_raw)

    # Sort by id for consistency
    game_items.sort(key=lambda x: x["id"])

    return game_items


def save_game_items(items):
    OUTPUT_PATH.write_text(
        json.dumps(items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Saved {len(items)} items to {OUTPUT_PATH.resolve()}")


def main():
    items = build_game_items()
    save_game_items(items)


if __name__ == "__main__":
    main()
