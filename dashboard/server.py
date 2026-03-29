from __future__ import annotations

import json
import logging
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

import uvicorn

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

load_dotenv(Path(__file__).parent.parent / "verifier" / ".env")

SOLANA_RPC_URL: str = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")
SOLANA_KEYPAIR_JSON: str = os.getenv("SOLANA_KEYPAIR", "[]")
MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
CACHE_TTL = 30  # seconds

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger("dashboard")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_cache: dict = {"blocks": None, "pubkey": None, "ts": 0.0}


def derive_pubkey() -> Optional[str]:
    raw = SOLANA_KEYPAIR_JSON.strip()
    if not raw or raw == "[]":
        return None
    try:
        from solders.keypair import Keypair
        kp = Keypair.from_bytes(bytes(json.loads(raw)))
        return str(kp.pubkey())
    except Exception as exc:
        log.error("keypair derivation failed: %s", exc)
        return None


def rpc(method: str, params: list) -> object:
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    with httpx.Client(timeout=30) as client:
        r = client.post(SOLANA_RPC_URL, json=payload)
        r.raise_for_status()
        body = r.json()
    if "error" in body:
        raise RuntimeError(f"RPC error: {body['error']}")
    return body.get("result")


def fetch_blocks(pubkey: str) -> list[dict]:
    blocks: list[dict] = []
    before: Optional[str] = None

    while True:
        params: list = [pubkey, {"limit": 50}]
        if before:
            params[1]["before"] = before

        sigs = rpc("getSignaturesForAddress", params)
        if not sigs:
            break

        for s in sigs:
            sig = s["signature"]
            try:
                tx = rpc("getTransaction", [
                    sig,
                    {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0},
                ])
                if not tx:
                    raise ValueError("null tx")

                memo_data: Optional[dict] = None
                instructions = (
                    tx.get("transaction", {})
                    .get("message", {})
                    .get("instructions", [])
                )
                for ix in instructions:
                    if (
                        ix.get("program") == "spl-memo"
                        or ix.get("programId") == MEMO_PROGRAM_ID
                    ):
                        raw_memo = ix.get("parsed", "")
                        if isinstance(raw_memo, str):
                            try:
                                memo_data = json.loads(raw_memo)
                            except json.JSONDecodeError:
                                memo_data = {"raw": raw_memo}
                        elif isinstance(raw_memo, dict):
                            memo_data = raw_memo
                        break

                block_time = tx.get("blockTime")
                ts = (
                    datetime.fromtimestamp(block_time, tz=timezone.utc).isoformat()
                    if block_time
                    else None
                )
                blocks.append({
                    "signature": sig,
                    "slot": s.get("slot"),
                    "timestamp": ts,
                    "memo": memo_data,
                    "err": s.get("err") is not None,
                })
            except Exception as exc:
                log.warning("skipping tx %s: %s", sig[:16], exc)
                blocks.append({
                    "signature": sig,
                    "slot": s.get("slot"),
                    "timestamp": None,
                    "memo": None,
                    "err": True,
                })

        if len(sigs) < 50:
            break
        before = sigs[-1]["signature"]

    return blocks


def cached_blocks() -> tuple[list[dict], Optional[str]]:
    now = time.monotonic()
    if _cache["blocks"] is None or (now - _cache["ts"]) > CACHE_TTL:
        pubkey = derive_pubkey()
        if not pubkey:
            log.warning("no Solana keypair — returning empty dataset")
            return [], None
        log.info("fetching blockchain data for %s …", pubkey)
        blocks = fetch_blocks(pubkey)
        _cache.update({"blocks": blocks, "pubkey": pubkey, "ts": now})
        log.info("cached %d blocks", len(blocks))
    return _cache["blocks"], _cache["pubkey"]


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="SentinelAI Dashboard API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/blockchain")
def api_blockchain():
    blocks, pubkey = cached_blocks()
    return JSONResponse({"blocks": blocks, "public_key": pubkey})


@app.get("/api/analytics")
def api_analytics():
    blocks, _ = cached_blocks()

    risk_blocks = [b for b in blocks if b.get("memo") and b["memo"].get("t") == "risk"]

    # --- pie: accepted vs rejected/denied --------------------------------
    accepted = sum(1 for b in risk_blocks if b["memo"].get("dec") == "accepted")
    total = len(risk_blocks)
    unaccepted = total - accepted

    # --- line: risks and prompts per calendar day ------------------------
    prompt_blocks = [b for b in blocks if b.get("memo") and b["memo"].get("t") == "prompt"]

    daily_risk: defaultdict[str, int] = defaultdict(int)
    for b in risk_blocks:
        if b.get("timestamp"):
            daily_risk[b["timestamp"][:10]] += 1

    daily_prompt: defaultdict[str, int] = defaultdict(int)
    for b in prompt_blocks:
        if b.get("timestamp"):
            daily_prompt[b["timestamp"][:10]] += 1

    all_dates = sorted(set(daily_risk) | set(daily_prompt))
    daily_sorted = [(d, daily_risk[d]) for d in all_dates]

    # --- bar: risks per source file --------------------------------------
    source_counts: defaultdict[str, int] = defaultdict(int)
    for b in risk_blocks:
        src = b["memo"].get("src") or "unknown"
        source_counts[src] += 1

    return JSONResponse({
        "pie": {"accepted": accepted, "unaccepted": unaccepted, "total": total},
        "line": {
            "dates": [d[0] for d in daily_sorted],
            "counts": [d[1] for d in daily_sorted],
            "prompt_counts": [daily_prompt[d[0]] for d in daily_sorted],
        },
        "bar": {
            "sources": list(source_counts.keys()),
            "counts": list(source_counts.values()),
        },
    })


@app.get("/")
def serve_index():
    return FileResponse(Path(__file__).parent / "index.html")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8003)
