"""Evidence-only mass-balance ledger for bound fertigation sessions.

This is NOT a second source of truth. It verifies that the persistent
`live.obligations[...].delivered_g` agrees with immutable accepted delivery
proofs, and refuses contradictory/ambiguous evidence. A baseline reflects
previously verified accounting, never estimates old manual deliveries.
"""
from .flow_evidence import number

EPSILON_G = 0.000001


def accept_delivery(state, obligation_id, session_id, event_id, obligation,
                    *, stock_l, mass_g, concentration_g_l, counter_status):
    """Atomically add one verified terminal delivery within caller transaction.

    Returns a review reason or None. Caller must check safe shutdown and
    authoritative session binding before invoking. No inferred pump duration,
    EC target or counter delta is used as fertilizer mass.
    """
    if not all(isinstance(x, str) and x for x in (obligation_id, session_id, event_id)):
        return "invalid_delivery_identity"
    delivered = obligation.get("delivered_g")
    target = (obligation.get("snapshot") or {}).get("target_g")
    if (not all(number(x) for x in (stock_l, mass_g, concentration_g_l, delivered, target))
            or stock_l < 0 or mass_g < 0 or delivered < 0 or target < 0
            or concentration_g_l <= 0
            or abs(stock_l * concentration_g_l - mass_g) > EPSILON_G):
        return "invalid_mass_balance_measurement"

    ledger = state.setdefault("mass_balance_evidence", {}).setdefault(obligation_id, {})
    baselines = state.setdefault("mass_balance_baselines", {})
    if obligation_id not in baselines:
        if ledger:
            return "mass_balance_baseline_missing_requires_review"
        baselines[obligation_id] = delivered
    baseline = baselines[obligation_id]
    if not number(baseline) or baseline < 0:
        return "invalid_mass_balance_baseline"

    previously_accepted = 0.0
    for bound_session, proof in ledger.items():
        if not isinstance(bound_session, str) or not isinstance(proof, dict):
            return "invalid_mass_balance_existing_evidence"
        mass = proof.get("mass_g")
        if (not number(mass) or mass < 0
                or proof.get("safe_shutdown_verified") is not True):
            return "invalid_mass_balance_existing_evidence"
        previously_accepted += mass
    if abs(baseline + previously_accepted - delivered) > EPSILON_G:
        return "mass_balance_ledger_mismatch_requires_review"
    if session_id in ledger:
        return "duplicate_bound_session_delivery_requires_review"
    if delivered + mass_g > target + EPSILON_G and mass_g > 0:
        return "mass_balance_target_exceeded_requires_review"

    ledger[session_id] = {
        "event_id": event_id, "actual_stock_l": stock_l, "mass_g": mass_g,
        "concentration_g_l": concentration_g_l,
        "counter_status": counter_status, "safe_shutdown_verified": True
    }
    return None
