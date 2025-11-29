import json
from pathlib import Path

# Paths
ITEMS_COMPLETE_PATH = Path("items-complete.json")      # from osrsreboxed
GAME_ITEMS_PATH = Path("osrs_game_items.json")         # your existing file
OUTPUT_PATH = Path("osrs_game_items_patched.json")     # or overwrite GAME_ITEMS_PATH if you want


def load_items_complete():
    if not ITEMS_COMPLETE_PATH.exists():
        raise FileNotFoundError(
            f"{ITEMS_COMPLETE_PATH} not found. Make sure it's in the same folder."
        )

    with ITEMS_COMPLETE_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)

    # Handle dict or list format
    if isinstance(data, dict):
        items = list(data.values())
    elif isinstance(data, list):
        items = data
    else:
        raise TypeError("Unexpected JSON structure in items-complete.json")

    # Build mapping: id -> slot (from equipment.slot or item_slot)
    slot_by_id = {}
    for item in items:
        item_id = item.get("id")
        if item_id is None:
            continue

        slot = None
        equipment = item.get("equipment") or {}
        if isinstance(equipment, dict):
            slot = equipment.get("slot")

        if not slot:
            slot = item.get("item_slot")

        slot_by_id[item_id] = slot or "none"

    return slot_by_id


def load_game_items():
    if not GAME_ITEMS_PATH.exists():
        raise FileNotFoundError(
            f"{GAME_ITEMS_PATH} not found. Run your generator once first."
        )

    with GAME_ITEMS_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def patch_slots():
    slot_by_id = load_items_complete()
    game_items = load_game_items()

    updated = 0
    missing = 0

    for item in game_items:
        item_id = item.get("id")
        if item_id is None:
            continue

        new_slot = slot_by_id.get(item_id)
        if new_slot is None:
            missing += 1
            continue

        old_slot = item.get("slot", "none")
        if old_slot != new_slot:
            item["slot"] = new_slot
            updated += 1

    print(f"Updated slot for {updated} items.")
    if missing:
        print(f"Could not find slot info for {missing} items (left unchanged).")

    # Save to new file (safe)
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(game_items, f, ensure_ascii=False, indent=2)

    print(f"Patched items written to {OUTPUT_PATH.resolve()}")


if __name__ == "__main__":
    patch_slots()
