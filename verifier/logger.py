from __future__ import annotations
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_keypair = None
_client = None

MEMO_PROGRAM_ID_STR = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"


def _get_client():
    global _keypair, _client
    if _client is not None:
        return _client, _keypair

    try:
        from solana.rpc.api import Client
        from solders.keypair import Keypair

        rpc_url = os.environ.get("SOLANA_RPC_URL", "https://api.devnet.solana.com")
        keypair_raw = os.environ.get("SOLANA_KEYPAIR", "")

        if keypair_raw:
            _keypair = Keypair.from_bytes(bytes(json.loads(keypair_raw)))
        else:
            _keypair = Keypair()
            logger.info("Generated ephemeral Solana keypair: %s", _keypair.pubkey())

        _client = Client(rpc_url)
        return _client, _keypair
    except Exception as exc:
        logger.error("Solana client init failed: %s", exc)
        return None, None


async def _send_memo(data: dict) -> Optional[str]:
    """Encode data as JSON and write it on-chain via the SPL Memo program."""
    try:
        client, keypair = _get_client()
        if client is None or keypair is None:
            return None

        from solders.pubkey import Pubkey
        from solders.instruction import Instruction, AccountMeta
        from solders.message import Message
        from solders.transaction import Transaction
        from solana.rpc.types import TxOpts

        memo_bytes = json.dumps(data, separators=(",", ":"))[:566].encode("utf-8")
        logger.debug("Solana memo payload (%d bytes): %s", len(memo_bytes), memo_bytes.decode())

        memo_ix = Instruction(
            program_id=Pubkey.from_string(MEMO_PROGRAM_ID_STR),
            accounts=[AccountMeta(pubkey=keypair.pubkey(), is_signer=True, is_writable=False)],
            data=memo_bytes,
        )

        blockhash = client.get_latest_blockhash().value.blockhash
        msg = Message([memo_ix], keypair.pubkey())
        tx = Transaction([keypair], msg, blockhash)
        result = client.send_transaction(tx, opts=TxOpts(skip_confirmation=False, preflight_commitment="confirmed"))
        return str(result.value)
    except Exception as exc:
        logger.error("Solana _send_memo failed: %s", exc)
        return None


async def log_prompt(uid: str, trace: str, decision: str) -> Optional[str]:
    """Log a prompt-level block after the user has made their decision."""
    sig = await _send_memo({
        "t": "prompt",
        "uid": uid,
        "trace": trace[:300],
        "dec": decision,
        "ts": datetime.now(timezone.utc).isoformat(),
    })
    if sig:
        logger.info("Solana prompt block written  | uid=%s decision=%s | sig=%s", uid, decision, sig)
    else:
        logger.error("Solana prompt block FAILED   | uid=%s decision=%s", uid, decision)
    return sig


async def log_risk(prompt_uid: str, risk_id: str, subject: str, reason: str, source_file: str, decision: str) -> Optional[str]:
    """Log a risk-level block with the user's decision embedded. One transaction per violation."""
    sig = await _send_memo({
        "t": "risk",
        "puid": prompt_uid,
        "rid": risk_id,
        "subj": subject[:120],
        "reason": reason[:150],
        "src": source_file,
        "dec": decision,
        "ts": datetime.now(timezone.utc).isoformat(),
    })
    if sig:
        logger.info("Solana risk block written    | puid=%s rid=%s src=%s decision=%s | sig=%s", prompt_uid, risk_id, source_file, decision, sig)
    else:
        logger.error("Solana risk block FAILED     | puid=%s rid=%s subject=%s", prompt_uid, risk_id, subject)
    return sig


async def log_event(event_dict: dict) -> Optional[str]:
    """Legacy: log a generic dashboard event. Delegates to _send_memo."""
    return await _send_memo(event_dict)
