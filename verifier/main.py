import asyncio
import logging
import os
import sys
from datetime import datetime, timezone
from uuid import uuid4

from dotenv import load_dotenv
load_dotenv()

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from models import (
    DashboardEvent,
    ExecutionResultRequest,
    MultipleRisksResponse,
    Risk,
    SingleRiskResponse,
    ValidatedResponse,
    VerifierResponse,
    VerifyRequest,
)
from scanner import scan_commands
from auditor import audit_commands
from logger import log_to_solana

logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger(__name__)

app = FastAPI(title="SentinelAI Verifier")

GATEWAY_CALLBACK_URL = os.environ.get(
    "GATEWAY_CALLBACK_URL", "http://localhost:8001/sentinel/verify-result"
)
AGENT_ID = os.environ.get("AGENT_ID", "copilot-default")


def emit_event(event: DashboardEvent) -> None:
    """Write one DashboardEvent as newline-delimited JSON to stdout."""
    sys.stdout.write(event.model_dump_json() + "\n")
    sys.stdout.flush()


async def log_and_emit(event: DashboardEvent) -> DashboardEvent:
    """Log to Solana (in thread pool to avoid blocking), update event, emit."""
    loop = asyncio.get_event_loop()
    tx = await loop.run_in_executor(None, log_to_solana, event)
    event.solana_tx = tx
    emit_event(event)
    return event


@app.post("/verify")
async def verify(request: VerifyRequest) -> JSONResponse:
    # Run regex scan and Gemini audit concurrently
    loop = asyncio.get_event_loop()
    regex_task = loop.run_in_executor(None, scan_commands, request.commands)
    audit_task = loop.run_in_executor(None, audit_commands, request.commands, request.trace)

    regex_risks, audit_risks = await asyncio.gather(regex_task, audit_task)

    # Deduplicate: regex takes priority over risks_md for the same command
    seen_commands: set[str] = set()
    deduped: list[Risk] = []

    for risk in regex_risks:
        if risk.command not in seen_commands:
            seen_commands.add(risk.command)
            deduped.append(risk)

    for risk in audit_risks:
        if risk.command not in seen_commands:
            seen_commands.add(risk.command)
            deduped.append(risk)

    # Build response
    if len(deduped) == 0:
        response: VerifierResponse = ValidatedResponse(status="VALIDATED", id=request.id)
    elif len(deduped) == 1:
        response = SingleRiskResponse(status="SINGLE_RISK", id=request.id, risk=deduped[0])
    else:
        response = MultipleRisksResponse(status="MULTIPLE_RISKS", id=request.id, risks=deduped)

    # Emit risk_detected events and log to Solana (concurrently)
    now = datetime.now(timezone.utc)
    emit_tasks = []
    for risk in deduped:
        event = DashboardEvent(
            event_id=str(uuid4()),
            request_id=request.id,
            timestamp=now,
            event_type="risk_detected",
            command=risk.command,
            risk=risk,
            solana_tx=None,
            agent_id=AGENT_ID,
            reasoning_trace=request.trace,
        )
        emit_tasks.append(log_and_emit(event))

    if emit_tasks:
        await asyncio.gather(*emit_tasks)

    # POST response back to MCP gateway
    response_dict = response.model_dump()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(GATEWAY_CALLBACK_URL, json=response_dict)
    except Exception as exc:
        logger.error("Failed to POST verify-result to gateway: %s", exc)

    return JSONResponse(content=response_dict)


@app.post("/execution-result")
async def execution_result(request: ExecutionResultRequest) -> JSONResponse:
    event_type = "human_approved" if request.approved else "human_denied"
    event = DashboardEvent(
        event_id=str(uuid4()),
        request_id=request.request_id,
        timestamp=datetime.now(timezone.utc),
        event_type=event_type,
        command=request.command,
        risk=None,
        solana_tx=None,
        agent_id=request.agent_id,
        reasoning_trace=request.trace,
    )
    await log_and_emit(event)
    return JSONResponse(content={"ok": True})
