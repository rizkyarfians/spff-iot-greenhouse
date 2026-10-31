"""Explicit boundary for incomplete physical delivery and safety contracts."""
from typing import Protocol


class DeliveryAdapter(Protocol):
    def collect(self, sessions: list[dict], recipe_id: str, day, *, obligation=None, now=None) -> tuple[list, bool]: ...


class SafetyAdapter(Protocol):
    def reasons(self, status: dict) -> list[str]: ...


class RecoveryAdapter(Protocol):
    def reasons(self, sessions: list[dict]) -> list[str]: ...


class UnreviewedRecoveryAdapter:
    def reasons(self, sessions):
        return (["terminal_fault_or_abort_requires_recovery_adapter"]
                if any(s.get("status") in ("fault", "aborted") for s in sessions) else [])


class ExplicitStatusSafetyAdapter:
    """Future adapter contract; existing firmware does not emit this envelope.

    A verified external adapter must normalize selector, stop latch, OTA,
    shutdown faults and ownership into a fresh device status. No such producer
    is installed by this package; therefore the default runtime holds.
    """
    def reasons(self, status):
        envelope = (status.get("raw_payload") or {}).get("adaptiveAiSafety")
        if (not isinstance(envelope, dict) or envelope.get("safe") is not True
                or any(envelope.get(key) is not False for key in
                       ("emergencyStop", "otaActive", "shutdownFault", "operatorStop", "relayOwnerActive"))
                or envelope.get("selectorMode") != "automatic"
                or "activeExecutionId" not in envelope or envelope["activeExecutionId"] is not None):
            return ["explicit_safety_adapter_missing_or_unsafe"]
        return []


class ExistingFinalSessionAdapter:
    """Only reviewed session-to-obligation links establish physical attribution.

    Session date alone is insufficient for cross-day continuation or changed
    concentration. No mapping is guessed and no link is written by the engine.
    """
    def __init__(self, complete=False):
        self.complete = complete

    def collect(self, sessions, recipe_id, day, *, obligation=None, now=None):
        from .core import number
        evidence, known = [], self.complete
        for session in sessions:
            link = session.get("_link")
            if not link:
                # Unknown deliveries could belong to this debt. Fail closed.
                known = False
                continue
            if obligation is None:
                known = False
                continue
            if str(link.get("obligation_id")) != str(obligation["obligation_id"]):
                continue
            recipe = obligation["recipe_snapshot"]
            event = session.get("_final_event") or {}
            payload = event.get("payload") or {}
            valid = (str(session.get("recipe_id")) == str(recipe_id)
                     and session.get("site_id") == obligation["site_id"]
                     and session.get("device_id") == obligation["device_id"]
                     and link.get("recipe_revision") == obligation["recipe_revision"]
                     and link.get("stock_concentration_g_per_l") == recipe["stock_concentration_g_per_l"]
                     and link.get("counter_reconciled") is True
                     and bool(link.get("review_reference")) and bool(link.get("reviewed_by"))
                     and session.get("status") in ("completed", "aborted", "fault")
                     and session.get("pumps_off") is True
                     and number(session.get("actual_stock_l")) and session["actual_stock_l"] >= 0
                     and number(session.get("actual_water_l")) and session["actual_water_l"] >= 0
                     and event.get("status") == session.get("status")
                     and event.get("recorded_at") == session.get("last_recorded_at")
                     and payload.get("actualStockL") == session.get("actual_stock_l")
                     and payload.get("actualWaterL") == session.get("actual_water_l")
                     and payload.get("pumpsOff") is True)
            recorded = session.get("last_recorded_at")
            if now is not None and (recorded is None or recorded.tzinfo is None or recorded > now):
                valid = False
            if not valid:
                known = False
                continue
            evidence.append((str(session["session_id"]), session["actual_stock_l"]))
        return evidence, known
