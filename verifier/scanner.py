from __future__ import annotations
import re
import uuid
from models import Risk

# 11 regex patterns covering common risky shell commands
PATTERNS: list[tuple[str, str]] = [
    (r"\brm\s+-rf\b", "Recursive force delete"),
    (r"\bmkfs\b", "Disk format command"),
    (r"\bdd\b.+\bof=/dev/", "Direct disk write via dd"),
    (r"\bchmod\s+777\b", "Overly permissive chmod 777"),
    (r"\bsudo\b", "Privilege escalation via sudo"),
    (r"\bcurl\b.+\|\s*(bash|sh)\b", "Pipe curl output to shell"),
    (r"\bwget\b.+\|\s*(bash|sh)\b", "Pipe wget output to shell"),
    (r"\beval\b", "Dynamic code execution via eval"),
    (r"\b(nc|netcat)\b.+-e\b", "Reverse shell via netcat"),
    (r"\biptables\b.+--flush\b", "Flush firewall rules"),
    (r"\b(shutdown|reboot|halt|poweroff)\b", "System shutdown/reboot command"),
]


def scan(commands: list[str]) -> list[Risk]:
    risks: list[Risk] = []
    for command in commands:
        for pattern, reason in PATTERNS:
            if re.search(pattern, command, re.IGNORECASE):
                risks.append(
                    Risk(
                        id=str(uuid.uuid4()),
                        command=command,
                        reason=reason,
                        source="regex",
                    )
                )
                break  # one risk per command
    return risks
