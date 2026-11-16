"""Shared deterministic GameVault mechanics.

No inferred numeric movement rates or ruleset time conversions are permitted.
This module is deliberately independent of the language model and campaign.
"""
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

VALID_SPEEDS = ("standard", "fast")
VALID_MODELS = ("default", "gpt-5.1-codex-mini", "gpt-5.1-codex", "gpt-5.1-codex-max")
# Only these models are allow-listed for configuration; availability is verified by the Codex host.
MAX_DURATION = 10000

@dataclass(frozen=True)
class Mechanics:
    action_count: int
    rounds: int
    minutes: float | None
    movement_rate: float | None

class MechanicsError(ValueError):
    pass

def preferences(state: dict[str, Any]) -> dict[str, str]:
    """Keep model choice and narrative speed separate. Never mutate old saves."""
    p = state.get("preferences")
    if not isinstance(p, dict):
        p = {}
    speed = p.get("responseSpeed", "standard")
    model = p.get("model", "default")
    return {
        "responseSpeed": speed if speed in VALID_SPEEDS else "standard",
        "model": model if model in VALID_MODELS else "default",
    }

def movement_rate(state: dict[str, Any]) -> float | None:
    """Return an *approved* movement figure; never invent a rate."""
    candidates = [
        state.get("character", {}).get("movementRate") if isinstance(state.get("character"), dict) else None,
        state.get("stats", {}).get("movementRate") if isinstance(state.get("stats"), dict) else None,
        state.get("rules", {}).get("movementRate") if isinstance(state.get("rules"), dict) else None,
    ]
    for v in candidates:
        if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 < v <= 100000:
            return float(v)
    return None

def duration_rules(state: dict[str, Any]) -> float | None:
    """Minutes per combat round, when explicitly supplied by selected ruleset."""
    rules = state.get("rules")
    if not isinstance(rules, dict):
        return None
    v = rules.get("minutesPerRound")
    if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 < v <= 120:
        return float(v)
    return None

def apply_mechanics(state: dict[str, Any], proposal: dict[str, Any], *, clarification: bool = False) -> tuple[dict[str, Any], Mechanics]:
    """Persist time without conflating rounds, turns and minutes.

    A clarification is never charged. A played action increments the action
    count exactly once, even if no safe ruleset timing is available. A model's
    reported minutes are ignored: only authoritative rules allow conversion.
    """
    result = deepcopy(state)
    clock = result.get("mechanics")
    clock = deepcopy(clock) if isinstance(clock, dict) else {}
    def count(key: str) -> int:
        v = clock.get(key, 0)
        if type(v) is not int or v < 0:
            raise MechanicsError("Invalid saved " + key)
        return v
    actions, rounds = count("actionCount"), count("elapsedRounds")
    old_minutes = clock.get("elapsedMinutes")
    if old_minutes is not None and (not isinstance(old_minutes, (int, float)) or isinstance(old_minutes, bool) or old_minutes < 0):
        raise MechanicsError("Invalid saved elapsedMinutes")
    n = proposal.get("durationRounds", 0)
    if type(n) is not int or not 0 <= n <= MAX_DURATION:
        raise MechanicsError("Invalid durationRounds")
    if clarification:
        n = 0
    else:
        actions += 1
    rounds += n
    per_round = duration_rules(result)
    # Preserve any existing authoritative minutes. Never reset or invent them.
    minutes = (rounds * per_round) if per_round is not None and old_minutes is None else old_minutes
    if per_round is not None and old_minutes is not None:
        minutes = float(old_minutes) + n * per_round
    clock["actionCount"] = actions
    clock["elapsedRounds"] = rounds
    if minutes is not None:
        clock["elapsedMinutes"] = minutes
    clock["elapsedTimeUnit"] = "rounds"
    result["mechanics"] = clock
    return result, Mechanics(actions, rounds, minutes, movement_rate(result))

def gm_guidance(state: dict[str, Any]) -> str:
    p = preferences(state)
    rate = movement_rate(state)
    clock = duration_rules(state)
    return (
        "GAMEVAULT SHARED GAMEPLAY POLICY (all games and branches):\n"
        "Resolve player-declared ordinary actions automatically using the approved "
        "character rules, then the selected game ruleset, then campaign solo rules. "
        "Never ask the player to supply routine mechanics. Do not invent any numeric "
        "movement rate. Resolve a run toward an exit with direction, obstacles, "
        "pursuit and risk; do not guarantee escape. If a ruleset-required numerical "
        "value is truly unavailable, report the exceptional limitation without "
        "pretending a roll or outcome occurred.\n"
        "Do not equate exploration turns, combat rounds and minutes. A clarification "
        "costs zero action count and zero game time. Return durationRounds as a "
        "nonnegative integer; return 0 when no time is safely justified. "
        "Do not invent elapsed-minute or turn labels. Preserve every map segment, "
        "save, inventory item and other branch.\n"
        f"Approved movement rate: {rate if rate is not None else 'NOT RECORDED'}; "
        f"ruleset minutes per round: {clock if clock is not None else 'NOT RECORDED'}.\n"
        f"Narration mode: {p['responseSpeed']} (fast = concise narration, "
        "NOT relaxed rules or automatic success).\n"
        "Output a JSON object including durationRounds and isClarification. "
        "isClarification is true only if no in-game action was taken."
    )
