from __future__ import annotations
import os
import uuid
import logging
from pathlib import Path
from typing import Optional
import google.generativeai as genai
from models import Risk, IntentViolation

logger = logging.getLogger(__name__)

_RISKS_DIR = Path(os.environ.get("RISKS_DIR", str(Path(__file__).parent.parent / "risks")))


def _load_policies() -> str:
    """Read and concatenate all .md files in the risks/ directory, sorted by name."""
    if not _RISKS_DIR.is_dir():
        logger.warning("Risks directory not found at %s", _RISKS_DIR)
        return ""

    files = sorted(_RISKS_DIR.glob("*.md"))
    if not files:
        logger.warning("No .md policy files found in %s", _RISKS_DIR)
        return ""

    sections: list[str] = []
    for f in files:
        try:
            sections.append(f"### {f.name}\n\n{f.read_text(encoding='utf-8')}")
        except OSError as exc:
            logger.warning("Could not read policy file %s: %s", f, exc)

    logger.debug("Loaded %d policy file(s): %s", len(sections), [f.name for f in files])
    return "\n\n---\n\n".join(sections)


def _log_gemini_call(fn: str, prompt: str, response: genai.types.GenerateContentResponse) -> None:
    logger.debug("[%s] prompt:\n%s", fn, prompt)
    logger.debug("[%s] response:\n%s", fn, response.text)
    usage = getattr(response, "usage_metadata", None)
    if usage:
        logger.info(
            "[%s] tokens — prompt: %s  output: %s  total: %s",
            fn,
            getattr(usage, "prompt_token_count", "?"),
            getattr(usage, "candidates_token_count", "?"),
            getattr(usage, "total_token_count", "?"),
        )


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

    risks_md = _load_policies()
    if not risks_md:
        return []

    prompt = f"""You are a security auditor. Review these shell commands against the governance policy.

GOVERNANCE POLICIES:
{risks_md}

COMMANDS TO AUDIT:
{chr(10).join(f'- {c}' for c in commands)}

USER INTENT (trace):
{trace}

Return ONLY a JSON array of objects with keys: command, reason, source_file.
  source_file must be the exact filename (e.g. "RISKS.md") from the GOVERNANCE POLICIES section above that contains the violated rule.
If no violations found, return [].
Do not include markdown fences."""

    try:
        response = model.generate_content(prompt)
        _log_gemini_call("audit_commands", prompt, response)
        import json
        items = json.loads(response.text.strip())
        return [
            Risk(
                id=str(uuid.uuid4()),
                command=item["command"],
                reason=item["reason"],
                source=item.get("source_file", "risks_md"),
            )
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

    risks_md = _load_policies()
    if not risks_md:
        return []

    prompt = f"""You are a security policy enforcer. Review the user's request against the governance policy.

GOVERNANCE POLICIES:
{risks_md}

USER REQUEST:
{trace}

If the request violates the policy, return a JSON array of objects with keys:
  subject (short noun phrase describing what violates policy),
  reason (why it violates),
  policy_excerpt (the relevant excerpt from the policy files),
  source_file (the exact filename, e.g. "RISKS.md", from the GOVERNANCE POLICIES section above that contains the violated rule).

If no violations, return [].
Do not include markdown fences."""

    try:
        response = model.generate_content(prompt)
        _log_gemini_call("check_intent", prompt, response)
        import json
        items = json.loads(response.text.strip())
        return [
            IntentViolation(
                id=str(uuid.uuid4()),
                subject=item["subject"],
                reason=item["reason"],
                policy_excerpt=item["policy_excerpt"],
                source_file=item.get("source_file", "RISKS.md"),
            )
            for item in items
            if isinstance(item, dict) and all(k in item for k in ("subject", "reason", "policy_excerpt"))
        ]
    except Exception as exc:
        logger.error("Gemini check_intent failed: %s", exc)
        return []
