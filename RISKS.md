# SentinelAI Governance Policy

This file defines the risk policy enforced by SentinelAI for this workspace.
Edit this file to customize governance rules for your project.

## Blocked Actions

- **Destructive file operations**: `rm -rf`, bulk deletes, or any command that irreversibly removes files or directories without explicit backup confirmation.
- **Privilege escalation**: Use of `sudo`, `su`, or any command that elevates permissions beyond the current user context.
- **Network exfiltration**: Piping command output to remote hosts, curl/wget to untrusted URLs, or any command that sends data outside the local environment.
- **Disk-level writes**: `dd`, `mkfs`, or direct writes to `/dev/*` block devices.
- **Firewall modifications**: `iptables --flush` or equivalent — changes to network filtering rules require separate approval.
- **System shutdown**: `shutdown`, `reboot`, `halt`, `poweroff` commands are prohibited in automated contexts.
- **Reverse shells**: `nc -e`, `netcat -e`, or any command that provides remote shell access.
- **Dynamic code execution**: `eval` with user-controlled input is prohibited.

## Intent Violations

Requests that ask SentinelAI or Copilot to:
- Write malware, exploits, or tools designed to compromise systems
- Bypass authentication or authorization controls
- Exfiltrate credentials, secrets, or private data
- Modify security logging or audit trails

## Exemptions

- Unit test scaffolding that simulates risky commands in a sandboxed context is permitted if the test does not execute the command.
- Documentation that describes risky commands for educational purposes is permitted.
