import re
from uuid import uuid4
from models import Risk

# Patterns that flag a command as risky
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"rm\s+-rf"),                          "Recursive force delete"),
    (re.compile(r"chmod\s+[0-7]*7[0-7]*"),             "World-writable permission"),
    (re.compile(r">\s*/etc/"),                          "Overwrite system config"),
    (re.compile(r"curl.+\|\s*(bash|sh)"),               "Pipe remote script to shell"),
    (re.compile(r"dd\s+if="),                           "Raw disk write"),
    (re.compile(r"mkfs"),                               "Filesystem format"),
    (re.compile(r":\(\)\s*\{.*:\|:&\s*\};:"),          "Fork bomb"),
    (re.compile(r"mv\s+.+\s+/dev/null"),               "Silent file destruction"),
    (re.compile(r"sudo\s+"),                            "Privilege escalation"),
    (re.compile(r"eval\s+"),                            "Dynamic code execution"),
    (re.compile(r"base64\s+-d.+\|\s*(bash|sh)"),       "Obfuscated shell execution"),
]


def scan_commands(commands: list[str]) -> list[Risk]:
    """Return one Risk per command that matches a dangerous pattern."""
    risks: list[Risk] = []
    for command in commands:
        for pattern, reason in _PATTERNS:
            if pattern.search(command):
                risks.append(Risk(
                    id=str(uuid4()),
                    command=command,
                    reason=reason,
                    source="regex",
                ))
                break  # one risk per command from regex scan
    return risks
