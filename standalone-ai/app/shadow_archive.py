"""Fail-closed validation for one-time SHADOW decision history backfill.

No state mutation, pruning, MQTT, or actuator code belongs in this module.
"""
from datetime import datetime, timezone


def validate_shadow_decisions(state):
    if not isinstance(state, dict):
        raise ValueError("AI state must be an object")
    live = state.get("live")
    main = state.get("decisions")
    if not isinstance(live, dict) or not isinstance(live.get("decisions"), dict):
        raise ValueError("live decisions not available")
    if not isinstance(main, dict):
        raise ValueError("main decisions not available")

    seen_ids = set()
    rows = []
    for fingerprint, decision in live["decisions"].items():
        if not isinstance(fingerprint, str) or len(fingerprint) != 64 or any(
            char not in "0123456789abcdef" for char in fingerprint
        ):
            raise ValueError("invalid decision fingerprint")
        if not isinstance(decision, dict):
            raise ValueError("invalid decision payload")
        decision_id = decision.get("decision_id")
        if not isinstance(decision_id, str) or not decision_id or decision_id in seen_ids:
            raise ValueError("missing or duplicate decision ID")
        if main.get(decision_id) != decision:
            raise ValueError("live and main decision payloads differ")
        seen_ids.add(decision_id)

        at = decision.get("at")
        if not isinstance(at, str):
            raise ValueError("missing decision time")
        try:
            observed_at = datetime.fromisoformat(at.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("invalid decision time") from error
        if observed_at.tzinfo is None:
            raise ValueError("decision time must be UTC aware")
        observed_at = observed_at.astimezone(timezone.utc)
        rows.append((fingerprint, decision_id, observed_at, decision))

    if set(main) != seen_ids:
        raise ValueError("main ledger contains unmatched decisions")
    if not rows:
        raise ValueError("no decisions to archive")
    current = state.get("current_decision_id")
    if current is not None and current not in seen_ids:
        raise ValueError("current decision missing from ledger")
    return rows
