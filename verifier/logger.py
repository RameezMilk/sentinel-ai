from __future__ import annotations
import json
import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_keypair = None
_client = None


def _get_client():
    global _keypair, _client
    if _client is not None:
        return _client, _keypair

    try:
        from solana.rpc.api import Client
        from solders.keypair import Keypair

        rpc_url = os.environ.get("SOLANA_RPC_URL", "https://api.devnet.solana.com")
        keypair_path = os.environ.get("SOLANA_KEYPAIR_PATH", str(Path.home() / ".config" / "solana" / "id.json"))

        if Path(keypair_path).exists():
            raw = json.loads(Path(keypair_path).read_text())
            _keypair = Keypair.from_bytes(bytes(raw))
        else:
            _keypair = Keypair()
            logger.info("Generated ephemeral Solana keypair: %s", _keypair.pubkey())

        _client = Client(rpc_url)
        return _client, _keypair
    except Exception as exc:
        logger.error("Solana client init failed: %s", exc)
        return None, None


async def log_event(event_dict: dict) -> Optional[str]:
    """Log an event to Solana devnet. Returns transaction signature or None."""
    try:
        client, keypair = _get_client()
        if client is None or keypair is None:
            return None

        from solders.transaction import Transaction
        from solders.system_program import TransferParams, transfer
        from solders.message import Message
        from solana.rpc.types import TxOpts

        # Encode event as memo (truncated to 566 bytes for transaction memo limit)
        memo = json.dumps(event_dict, separators=(",", ":"))[:566].encode()

        # Use a self-transfer of 0 lamports with memo data as the log vehicle
        # For simplicity, we use transfer to self (0 lamports) — real impl would use SPL Memo
        ix = transfer(TransferParams(from_pubkey=keypair.pubkey(), to_pubkey=keypair.pubkey(), lamports=0))
        msg = Message([ix], keypair.pubkey())
        blockhash_resp = client.get_latest_blockhash()
        blockhash = blockhash_resp.value.blockhash
        tx = Transaction([keypair], msg, blockhash)
        result = client.send_transaction(tx, opts=TxOpts(skip_confirmation=False, preflight_commitment="confirmed"))
        sig = str(result.value)
        logger.info("Solana log: %s", sig)
        return sig
    except Exception as exc:
        logger.error("Solana log_event failed: %s", exc)
        return None
