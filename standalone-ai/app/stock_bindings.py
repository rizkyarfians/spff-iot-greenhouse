"""Explicit, revision-pinned stock recipe bindings for isolated SHADOW planning.

The operational SPFF PostgreSQL database is READ ONLY. This module persists
only a preview mapping in the staging AI state store (typically isolated SQLite).
Never infer stock formulations based on matching names or crop HST alone.
"""
import argparse
import json
from datetime import datetime, timezone
from math import isfinite


def mapping_key(program_id, activity_id, source_row):
    if not isinstance(program_id, str) or not program_id or len(program_id) > 200:
        raise ValueError("invalid program_id")
    if not isinstance(activity_id, str) or not activity_id.startswith("row-") or not activity_id[4:].isdigit():
        raise ValueError("invalid activity_id")
    if type(source_row) is not int or not (1 <= source_row <= 100000):
        raise ValueError("invalid source_row")
    return json.dumps([program_id, activity_id, source_row], separators=(",", ":"))


def _concentration(value):
    try:
        converted = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return converted if isfinite(converted) and 0 < converted <= 1_000_000 else None


def _name(value):
    return " ".join(value.strip().casefold().split()) if isinstance(value, str) else ""


def _find_product(observation, program_id, activity_id, source_row):
    guide = observation.get("guide_programs")
    for program in guide.get("programs", []) if isinstance(guide, dict) else []:
        if not isinstance(program, dict) or program.get("program_id") != program_id:
            continue
        for activity in program.get("activities", []):
            if not isinstance(activity, dict) or activity.get("activity_id") != activity_id:
                continue
            for product in activity.get("products", []):
                if isinstance(product, dict) and product.get("source_row") == source_row:
                    return program, activity, product
    return None, None, None


def validate_binding_candidate(observation, program_id, activity_id, source_row, recipe_id):
    if not isinstance(observation, dict) or observation.get("schema_compatible") is not True:
        raise ValueError("SPFF source schema unavailable")
    mapping_key(program_id, activity_id, source_row)
    if not isinstance(recipe_id, str) or not recipe_id or len(recipe_id) > 200:
        raise ValueError("invalid recipe_id")
    program, activity, product = _find_product(observation, program_id, activity_id, source_row)
    if not program or not product or product.get("is_fertilizer") is not True:
        raise ValueError("Guide fertilizer product not found")
    if product.get("review_reasons"):
        raise ValueError("Guide fertilizer product needs review")
    if any(reason in (program.get("hold_reasons") or []) for reason in (
        "device_binding_not_verified", "crop_binding_not_verified",
        "saved_population_mismatch", "saved_area_mismatch",
        "guide_edits_changed_since_program_was_saved",
        "invalid_saved_program_snapshot",
    )):
        raise ValueError("Guide program changed or requires review")
    recipes = observation.get("approved_programs")
    matches = [
        r for r in recipes if isinstance(r, dict) and str(r.get("recipe_id")) == recipe_id
    ] if isinstance(recipes, list) else []
    if len(matches) != 1:
        raise ValueError("Unique approved recipe not found in selected site/crop/zone")
    recipe = matches[0]
    if recipe.get("approval_status") != "approved":
        raise ValueError("Stock recipe is not approved")
    if _name(recipe.get("fertilizer_name")) != _name(product.get("product")):
        raise ValueError("Stock recipe fertilizer name differs from selected Guide product")
    hst = activity.get("hst")
    hst_from = recipe.get("hst_from")
    hst_to = recipe.get("hst_to")
    if (type(hst) is not int or type(hst_from) is not int or type(hst_to) is not int
            or not hst_from <= hst <= hst_to):
        raise ValueError("Stock recipe HST range does not cover selected Guide activity")
    if _concentration(recipe.get("stock_concentration_g_per_l")) is None:
        raise ValueError("Stock recipe concentration is missing or invalid")
    program_revision = program.get("revision")
    recipe_revision = recipe.get("revision")
    if type(program_revision) is not int or program_revision < 1:
        raise ValueError("Invalid Guide program revision")
    if type(recipe_revision) is not int or recipe_revision < 1:
        raise ValueError("Invalid stock recipe revision")
    source_sha = program.get("source_sha256")
    if not isinstance(source_sha, str) or len(source_sha) != 64:
        raise ValueError("Guide source hash is unavailable")
    return {
        "program_id": program_id,
        "activity_id": activity_id,
        "source_row": source_row,
        "product": product.get("product"),
        "recipe_id": recipe_id,
        "program_revision": program_revision,
        "source_sha256": source_sha,
        "recipe_revision": recipe_revision,
        "stock_concentration_g_l": _concentration(recipe.get("stock_concentration_g_per_l")),
    }


def resolve_binding(observation, mappings, program, activity, product):
    key = mapping_key(program["program_id"], activity["activity_id"], product["source_row"])
    entry = mappings.get(key) if isinstance(mappings, dict) else None
    if not isinstance(entry, dict):
        return None, "UNBOUND", None
    try:
        candidate = validate_binding_candidate(
            observation, program["program_id"], activity["activity_id"],
            product["source_row"], entry.get("recipe_id")
        )
    except ValueError:
        return None, "STALE", None
    if any(entry.get(f) != candidate.get(f) for f in (
        "program_revision", "source_sha256", "recipe_revision", "product",
        "stock_concentration_g_l"
    )):
        return None, "STALE", None
    recipes = observation.get("approved_programs", [])
    recipe = next((r for r in recipes if isinstance(r, dict)
                   and str(r.get("recipe_id")) == entry["recipe_id"]), None)
    if not isinstance(recipe, dict):
        return None, "STALE", None
    concentration = _concentration(recipe.get("stock_concentration_g_per_l"))
    return concentration, "BOUND", entry["recipe_id"]


def save_binding(store, observation, program_id, activity_id, source_row, recipe_id):
    """Explicit local operator operation; no writes to SPFF operational tables."""
    candidate = validate_binding_candidate(observation, program_id, activity_id, source_row, recipe_id)
    candidate["linked_at"] = datetime.now(timezone.utc).isoformat()
    with store.transaction() as state:
        state.setdefault("guide_stock_bindings", {})[
            mapping_key(program_id, activity_id, source_row)
        ] = candidate
    return candidate


def main():
    from .settings import Settings, ROOT
    from .source import SPFFSource
    from .store import SQLiteStore
    parser = argparse.ArgumentParser(description="Local staging SHADOW stock binding; no production writes")
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("candidates")
    actions.add_parser("list")
    bind = actions.add_parser("bind")
    bind.add_argument("--program-id", required=True)
    bind.add_argument("--activity-id", required=True)
    bind.add_argument("--source-row", type=int, required=True)
    bind.add_argument("--recipe-id", required=True)
    args = parser.parse_args()
    settings = Settings.load()
    if settings.mode != "SHADOW_MODE" or settings.state_dsn:
        parser.error("binding CLI is permitted only for isolated SQLite SHADOW staging")
    if not settings.source_dsn:
        parser.error("set AI_SOURCE_DSN for read-only SPFF source")
    scope = f"{settings.site_id}/{settings.device_id}/{settings.zone_id}/source-shadow"
    source = SPFFSource(settings.source_dsn, settings.site_id, settings.device_id,
                        settings.zone_id, fertilizer_delivery_route=settings.fertilizer_delivery_route)
    store = SQLiteStore(str(ROOT / settings.state_path), scope)
    try:
        if args.action == "list":
            print(json.dumps(list(store.read().get("guide_stock_bindings", {}).values()), indent=2))
            return
        observation = source.inspect()
        if args.action == "candidates":
            guides = observation.get("guide_programs", {})
            for program in guides.get("programs", []):
                for activity in program.get("activities", []):
                    for product in activity.get("products", []):
                        if product.get("is_fertilizer"):
                            print("GUIDE", program["program_id"], "rev", program["revision"],
                                  activity["activity_id"], "HST", activity.get("hst"),
                                  product["source_row"], product["product"])
            for recipe in observation.get("approved_programs", []):
                print("RECIPE", recipe.get("recipe_id"), "rev", recipe.get("revision"),
                      recipe.get("fertilizer_name"),
                      "HST", recipe.get("hst_from"), "-", recipe.get("hst_to"),
                      "concentration g/L", _concentration(recipe.get("stock_concentration_g_per_l")))
            return
        record = save_binding(store, observation, args.program_id,
                              args.activity_id, args.source_row, args.recipe_id)
        print(json.dumps(record, indent=2))
        print("SHADOW ONLY: binding saved; no pump control or production DB writes")
    except ValueError as error:
        parser.error(str(error))
    finally:
        store.close()


if __name__ == "__main__":
    main()
