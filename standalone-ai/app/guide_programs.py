"""Read-only previews of SPFF migration 034's saved Panduan programs.

The server-owned plan is already scaled by the web backend. Do not scale again,
sum products into a batch, infer stock concentration from spray water, or count
manual activity completion as measured pump delivery.
"""
import math
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


class GuideModel(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)


class GuideConfig(GuideModel):
    cropId: str = Field(min_length=1)
    plantingDate: date
    basis: str
    quantity: float = Field(gt=0, le=1e7, strict=True)
    deviceId: str | None

    @model_validator(mode="after")
    def basis_valid(self):
        if self.basis not in ("plants", "area") or (self.basis == "plants" and not self.quantity.is_integer()):
            raise ValueError("invalid population basis")
        return self


class Requirement(GuideModel):
    row: int = Field(ge=1, strict=True)
    product: str = Field(min_length=1)
    dose: float | None = Field(default=None, ge=0, strict=True)
    doseUnit: str = ""
    amount: float | None = Field(default=None, ge=0, strict=True)
    unit: str = ""
    waterL: float | None = Field(default=None, ge=0, strict=True)
    warnings: list[str] = Field(default_factory=list)


class Activity(GuideModel):
    id: str = Field(pattern=r"^row-\d+$")
    hst: int | None = Field(ge=-1000, le=1000, strict=True)
    title: str
    method: str
    waterL: float | None = Field(default=None, ge=0, strict=True)
    requirements: list[Requirement]
    warnings: list[str] = Field(default_factory=list)


class SavedPlan(GuideModel):
    cropName: str
    plants: float = Field(gt=0, strict=True)
    area: float = Field(gt=0, strict=True)
    activities: list[Activity]


GUIDE_COLUMNS = {
    "guide_programs": {"site_id", "program_id", "revision", "config", "source_sha256", "guide_revision", "sheet_snapshot", "plan", "created_at"},
    "protocol_guide_edits": {"site_id", "crop_id", "source_sha256", "revision"},
    "guide_program_completions": {"site_id", "program_id", "activity_id", "program_revision", "completed_at"},
}

# Explicit mapping for the currently supported crop, never free-text matching.
GUIDE_CROP_BINDINGS = {"ubi-jalar": "sweet-potato"}


def mass_g(amount, unit):
    if amount is None:
        return None
    unit = unit.lower().strip()
    return amount * 1000 if unit == "kg" else amount if unit in ("g", "gram", "gr") else None


def summarize_program(row, completions, latest_edit, selected_crop, device_id, now=None,
                      fertilizer_delivery_route="reference"):
    if fertilizer_delivery_route not in ("reference", "drip"):
        raise ValueError("unknown fertilizer delivery route")
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(ZoneInfo("Asia/Jakarta")).date()
    result = {"program_id": str(row["program_id"]), "revision": row["revision"],
              "source": "spff.guide_programs.plan", "guide_revision": row["guide_revision"],
              "source_sha256": row["source_sha256"], "can_dispatch": False,
              "planning_only": True, "fertilizer_delivery_route": fertilizer_delivery_route, "activities": []}
    try:
        config = GuideConfig.model_validate(row["config"])
        plan = SavedPlan.model_validate(row["plan"])
    except (ValidationError, TypeError):
        return {**result, "status": "REQUIRES_REVIEW", "hold_reasons": ["invalid_saved_program_snapshot"]}
    reasons = ["volume_session_and_safety_contract_not_verified"]
    if fertilizer_delivery_route == "drip":
        reasons.extend(["stock_batch_not_configured", "drip_formulation_not_verified"])
    else:
        reasons.append("application_route_not_verified_for_drip")
    if config.deviceId != device_id:
        reasons.append("device_binding_not_verified")
    if GUIDE_CROP_BINDINGS.get(config.cropId) != selected_crop or selected_crop is None:
        reasons.append("crop_binding_not_verified")
    if config.basis == "plants" and not math.isclose(config.quantity, plan.plants, rel_tol=1e-9):
        reasons.append("saved_population_mismatch")
    if config.basis == "area" and not math.isclose(config.quantity, plan.area, rel_tol=1e-9):
        reasons.append("saved_area_mismatch")
    changed = bool(latest_edit and (latest_edit["source_sha256"] != row["source_sha256"] or int(latest_edit["revision"]) != int(row["guide_revision"])))
    if changed:
        reasons.append("guide_edits_changed_since_program_was_saved")
    result.update(status="PREVIEW_ONLY", config=config.model_dump(mode="json"),
                  crop_name=plan.cropName, plant_count=plan.plants, area_m2=plan.area,
                  current_hst=(today - config.plantingDate).days, timezone="Asia/Jakarta",
                  guide_edits_changed=changed, base_file_rechecked=False, hold_reasons=reasons)
    cells = row.get("sheet_snapshot", {}).get("cells", {})
    for activity in plan.activities:
        application_date = config.plantingDate + timedelta(days=activity.hst) if activity.hst is not None else None
        calendar_status = ("UNSCHEDULED" if application_date is None else "PAST_DUE" if application_date < today
                           else "DUE_TODAY" if application_date == today else "FUTURE")
        records = [{"program_revision": c["program_revision"], "completed_at": str(c["completed_at"])}
                   for c in completions if c["activity_id"] == activity.id]
        products = []
        for req in activity.requirements:
            amount_g = mass_g(req.amount, req.unit)
            review = list(req.warnings)
            dose_unit = req.doseUnit.lower().replace(" ", "").replace("gram", "g").replace("tan.", "tan")
            expected = None
            if req.dose is not None and dose_unit in ("g/tan", "kg/tan"):
                expected = req.dose * plan.plants * (1000 if dose_unit == "kg/tan" else 1)
                if amount_g is None or not math.isclose(expected, amount_g, rel_tol=1e-6, abs_tol=0.001):
                    review.append("saved_per_plant_mass_mismatch")
            if req.amount is None:
                review.append("computed_amount_unavailable")
            category_cell = cells.get("F" + str(req.row), {})
            category = category_cell.get("value") if isinstance(category_cell, dict) else None
            # Preserve source classification; a fertilizer route preference does not
            # silently authorize ZPT, pesticide or unknown-category products.
            fertilizer = isinstance(category, str) and (category.strip().lower() == "pupuk" or category.strip().lower().startswith("pupuk "))
            drip_requested = fertilizer_delivery_route == "drip" and fertilizer
            products.append({"source_row": req.row, "product": req.product, "category": category,
                             "source_method": activity.method, "is_fertilizer": fertilizer,
                             "requested_delivery_route": "drip" if drip_requested else None,
                             "route_request_source": "AI_FERTILIZER_DELIVERY_ROUTE" if drip_requested else None,
                             "drip_formulation_verified": False, "can_dispatch": False,
                             "dose": req.dose, "dose_unit": req.doseUnit,
                             "amount": req.amount, "unit": req.unit, "product_mass_g": amount_g,
                             "per_plant_crosscheck_g": expected,
                             "reference_water_l": req.waterL, "review_reasons": review,
                             "stock_concentration_g_l": None})
        result["activities"].append({"activity_id": activity.id, "hst": activity.hst,
            "application_date": str(application_date) if application_date else None,
            "calendar_status": calendar_status, "title": activity.title, "method": activity.method,
            "reference_water_l": activity.waterL, "warnings": activity.warnings,
            "products": products, "manual_completion_records": records,
            "manual_completion_is_measured_delivery": False, "measured_delivered_mass_g": None,
            "can_dispatch": False})
    return result


def read_guide_programs(connection, site_id, device_id, zone_id, now=None,
                        fertilizer_delivery_route="reference"):
    """Called inside an existing read-only transaction with dict_row enabled."""
    missing, missing_columns, denied = [], {}, []
    for table, required in GUIDE_COLUMNS.items():
        relation = "spff." + table
        metadata = connection.execute("SELECT to_regclass(%s) AS relation", (relation,)).fetchone()
        if metadata["relation"] is None:
            missing.append(relation)
            continue
        allowed = connection.execute("SELECT has_table_privilege(current_user,%s,'SELECT') AS allowed", (relation,)).fetchone()["allowed"]
        if not allowed:
            denied.append(relation)
            continue
        columns = {r["attname"] for r in connection.execute("SELECT attname FROM pg_attribute WHERE attrelid=to_regclass(%s) AND attnum>0 AND NOT attisdropped", (relation,)).fetchall()}
        if required - columns:
            missing_columns[relation] = sorted(required - columns)
    if missing or missing_columns or denied:
        return {"status": "NOT_READY", "missing_relations": missing, "missing_columns": missing_columns,
                "select_permission_required": denied, "programs": [], "can_dispatch": False}
    rows = connection.execute("SELECT program_id,revision,config,source_sha256,guide_revision,sheet_snapshot,plan FROM spff.guide_programs WHERE site_id=%s AND (config->>'deviceId'=%s OR config->>'deviceId' IS NULL) ORDER BY created_at", (site_id, device_id)).fetchall()
    edits = {r["crop_id"]: r for r in connection.execute("SELECT crop_id,source_sha256,revision FROM spff.protocol_guide_edits WHERE site_id=%s", (site_id,)).fetchall()}
    completions = connection.execute("SELECT c.program_id,c.activity_id,c.program_revision,c.completed_at FROM spff.guide_program_completions c JOIN spff.guide_programs p ON p.site_id=c.site_id AND p.program_id=c.program_id WHERE c.site_id=%s AND (p.config->>'deviceId'=%s OR p.config->>'deviceId' IS NULL)", (site_id, device_id)).fetchall()
    selection = connection.execute("SELECT crop_id FROM spff.site_crop_selections WHERE site_id=%s AND zone_id=%s", (site_id, zone_id)).fetchone()
    crop = selection["crop_id"] if selection else None
    programs = [summarize_program(row, [c for c in completions if c["program_id"] == row["program_id"]],
                                  edits.get(row["config"].get("cropId")) if isinstance(row["config"], dict) else None,
                                  crop, device_id, now, fertilizer_delivery_route) for row in rows]
    return {"status": "READ_ONLY_PREVIEW", "programs": programs, "can_dispatch": False,
            "fertilizer_delivery_route": fertilizer_delivery_route,
            "scope": {"site_id": site_id, "device_id": device_id, "zone_id": zone_id}}
