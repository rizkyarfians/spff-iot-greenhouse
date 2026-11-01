"""Read-only per-activity SPFF guide computations.

Guide reference water is FINAL SOLUTION volume, not verified delivered water.
Historic flow is an uncalibrated rate proxy, not an operational flow setting.
Stock volume is only an algebraic preview requiring an explicit concentration;
never infer concentration from sensor EC or the fertilizer flow meter.
"""


def _nonnegative(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value < 1e12 else None


def activity_planning_preview(activity, flow, stock_concentration_g_l=None):
    water = _nonnegative(activity.get("reference_water_l"))
    products = activity.get("products")
    fertilizers = [p for p in products if isinstance(p, dict) and p.get("is_fertilizer") is True] if isinstance(products, list) else []
    reasons = []
    mass = None
    if len(fertilizers) == 1:
        product = fertilizers[0]
        mass = _nonnegative(product.get("product_mass_g"))
        if mass is None or product.get("review_reasons"):
            mass = None
            reasons.append("fertilizer_mass_needs_review")
    elif len(fertilizers) > 1:
        reasons.append("multiple_fertilizers_not_combined")
    else:
        reasons.append("no_fertilizer_product")
    if water is None:
        reasons.append("guide_reference_water_missing")

    water_rate = _nonnegative(flow.get("water_lpm")) if isinstance(flow, dict) else None
    stock_rate = _nonnegative(flow.get("stock_lpm")) if isinstance(flow, dict) else None
    if water_rate is None or water_rate <= 0:
        water_rate = None
        reasons.append("historical_water_rate_unavailable")
    if stock_rate is None or stock_rate <= 0:
        stock_rate = None
        reasons.append("historical_stock_rate_unavailable")

    concentration = _nonnegative(stock_concentration_g_l)
    if concentration is None or concentration <= 0:
        concentration = None
        reasons.append("stock_concentration_not_provided")
    stock = mass / concentration if mass is not None and concentration is not None else None
    # Never claim an operational duration, and never add parallel water/stock
    # durations as if Venturi or pump sequence were independently certified.
    water_minutes = water / water_rate if water is not None and water_rate else None
    stock_minutes = stock / stock_rate if stock is not None and stock_rate else None
    return {
        "basis": "GUIDE_WITH_UNVERIFIED_HISTORICAL_FLOW",
        "water_l": water,
        "fertilizer_mass_g": mass,
        "stock_l": stock,
        "water_duration_minutes": water_minutes,
        "stock_duration_minutes": stock_minutes,
        "stock_concentration_g_l": concentration,
        "flow_reference": flow if isinstance(flow, dict) else None,
        "reasons": reasons,
        "can_dispatch": False,
    }
