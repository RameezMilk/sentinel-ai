import json
import logging
import os
import sys
from hashlib import sha256
from pathlib import Path

from models import DashboardEvent

logger = logging.getLogger(__name__)

_MEMO_MAX_BYTES = 566


def _get_rpc_url() -> str:
    return os.environ.get("SOLANA_RPC_URL", "https://api.devnet.solana.com")


def _get_keypair_path() -> Path:
    default = Path.home() / ".config" / "solana" / "id.json"
    return Path(os.environ.get("SOLANA_KEYPAIR_PATH", str(default)))


def _load_or_create_keypair():
    """Load keypair from disk or generate a new one and airdrop SOL."""
    from solders.keypair import Keypair  # type: ignore

    kp_path = _get_keypair_path()

    if kp_path.exists():
        with open(kp_path, "r") as f:
            secret = json.load(f)
        return Keypair.from_bytes(bytes(secret))

    # Generate new keypair
    logger.info("No keypair found at %s — generating new one", kp_path)
    kp = Keypair()
    kp_path.parent.mkdir(parents=True, exist_ok=True)
    with open(kp_path, "w") as f:
        json.dump(list(bytes(kp)), f)

    # Airdrop 1 SOL
    try:
        from solana.rpc.api import Client  # type: ignore
        from solders.pubkey import Pubkey  # type: ignore

        client = Client(_get_rpc_url())
        pubkey = kp.pubkey()
        resp = client.request_airdrop(pubkey, 1_000_000_000)
        logger.info("Airdrop requested: %s", resp)
    except Exception as exc:
        logger.warning("Airdrop failed (continuing anyway): %s", exc)

    return kp


def log_to_solana(event: DashboardEvent) -> str:
    """Log a DashboardEvent to Solana devnet as a Memo transaction.

    Returns the transaction signature or 'solana_unavailable' on error.
    """
    try:
        from solana.rpc.api import Client  # type: ignore
        from solana.transaction import Transaction  # type: ignore
        from solders.keypair import Keypair  # type: ignore
        from spl.memo.instructions import create_memo  # type: ignore

        memo_payload = {
            "sentinel": "1.0",
            "req": event.request_id[:8],
            "type": event.event_type,
            "cmd_hash": sha256(event.command.encode()).hexdigest()[:16],
            "risk_id": event.risk.id[:8] if event.risk else None,
            "ts": event.timestamp.isoformat(),
        }

        memo_str = json.dumps(memo_payload, separators=(",", ":"))
        memo_bytes = memo_str.encode("utf-8")[:_MEMO_MAX_BYTES]

        keypair = _load_or_create_keypair()
        client = Client(_get_rpc_url())

        memo_ix = create_memo(
            memo=memo_bytes,
            signers=[keypair.pubkey()],
        )

        txn = Transaction()
        txn.add(memo_ix)

        resp = client.send_transaction(txn, keypair)
        sig = str(resp.value)

        logger.info("Solana tx: %s", sig)
        return sig

    except Exception as exc:
        logger.error("Solana logging failed: %s", exc)
        return "solana_unavailable"
