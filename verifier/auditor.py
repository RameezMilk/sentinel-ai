import json
import logging
import os
import sys
from uuid import uuid4

import google.generativeai as genai

from models import Risk

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are a security auditor for an AI coding agent. You will be given:
1. A governance policy document (risks.md)
2. A list of shell commands the agent wants to execute
3. The agent's stated reasoning

Your task: identify any commands that violate the policies defined in risks.md.

Respond ONLY with valid JSON. No markdown, no explanation outside the JSON.

Schema:
{
  "violations": [
    {
      "command": "<exact command string>",
      "reason": "<one sentence: which policy was violated and why>",
      "policy_excerpt": "<the relevant line or section from risks.md>"
    }
  ]
}

If no violations, respond with: {"violations": []}"""


def _load_risks_md() -> str:
    path = os.environ.get("RISKS_MD_PATH", "./risks.md")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except OSError as exc:
        logger.error("Cannot read risks.md at %s: %s", path, exc)
        return ""


def audit_commands(commands: list[str], trace: str) -> list[Risk]:
    """Call Gemini to audit commands against risks.md policy. Fail open on error."""
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        logger.warning("GEMINI_API_KEY not set — skipping Gemini audit")
        return []

    risks_content = _load_risks_md()
    if not risks_content:
        return []

    numbered_commands = "\n".join(f"{i+1}. {cmd}" for i, cmd in enumerate(commands))
    user_message = (
        f"POLICY DOCUMENT:\n{risks_content}\n\n"
        f"COMMANDS TO AUDIT:\n{numbered_commands}\n\n"
        f"AGENT REASONING:\n{trace}"
    )

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash",
            system_instruction=_SYSTEM_PROMPT,
        )
        response = model.generate_content(user_message)
        raw = response.text.strip()

        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        data = json.loads(raw)
        violations = data.get("violations", [])

        risks: list[Risk] = []
        for v in violations:
            cmd = v.get("command", "")
            reason = v.get("reason", "Policy violation")
            if cmd:
                risks.append(Risk(
                    id=str(uuid4()),
                    command=cmd,
                    reason=reason,
                    source="risks_md",
                ))
        return risks

    except Exception as exc:
        logger.error("Gemini audit failed: %s", exc)
        return []
