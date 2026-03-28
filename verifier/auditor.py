from __future__ import annotations
import os
import uuid
import logging
from pathlib import Path
from typing import Optional
import google.generativeai as genai
from models import Risk, IntentViolation

logger = logging.getLogger(__name__)

_RISKS_MD_PATH = os.environ.get("RISKS_MD_PATH", str(Path(__file__).parent.parent / "RISKS.md"))


def _load_risks_md() -> str:
    try:
        return Path(_RISKS_MD_PATH).read_text(encoding="utf-8")
    except FileNotFoundError:
        logger.warning("RISKS.md not found at %s", _RISKS_MD_PATH)
        return ""


def _get_client() -> Optional[genai.GenerativeModel]:
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-2.5-flash")


async def audit_commands(commands: list[str], trace: str) -> list[Risk]:
    """Use Gemini to find risky commands not caught by regex, based on RISKS.md."""
    model = _get_client()
    if not model:
        return []

    risks_md = _load_risks_md()
    if not risks_md:
        return []

    prompt = f"""You are a security auditor. Review these shell commands against the governance policy.

GOVERNANCE POLICY (RISKS.md):
{risks_md}

COMMANDS TO AUDIT:
{chr(10).join(f'- {c}' for c in commands)}

USER INTENT (trace):
{trace}

Return ONLY a JSON array of objects with keys: command, reason.
If no violations found, return [].
Do not include markdown fences."""

    try:
        response = model.generate_content(prompt)
        import json
        items = json.loads(response.text.strip())
        return [
            Risk(id=str(uuid.uuid4()), command=item["command"], reason=item["reason"], source="risks_md")
            for item in items
            if isinstance(item, dict) and "command" in item and "reason" in item
        ]
    except Exception as exc:
        logger.error("Gemini audit_commands failed: %s", exc)
        return []


async def check_intent(trace: str) -> list[IntentViolation]:
    """Use Gemini to check if the user's intent violates RISKS.md policy."""
    model = _get_client()
    if not model:
        return []

    risks_md = _load_risks_md()
    if not risks_md:
        return []

    prompt = f"""You are a security policy enforcer. Review the user's request against the governance policy.

GOVERNANCE POLICY (RISKS.md):
{risks_md}

USER REQUEST:
{trace}

If the request violates the policy, return a JSON array of objects with keys:
  subject (short noun phrase describing what violates policy),
  reason (why it violates),
  policy_excerpt (the relevant excerpt from RISKS.md).

If no violations, return [].
Do not include markdown fences."""

    try:
        response = model.generate_content(prompt)
        import json
        items = json.loads(response.text.strip())
        return [
            IntentViolation(
                subject=item["subject"],
                reason=item["reason"],
                policy_excerpt=item["policy_excerpt"],
            )
            for item in items
            if isinstance(item, dict) and all(k in item for k in ("subject", "reason", "policy_excerpt"))
        ]
    except Exception as exc:
        logger.error("Gemini check_intent failed: %s", exc)
        return []
