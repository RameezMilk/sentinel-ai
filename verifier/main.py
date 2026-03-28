from __future__ import annotations
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from models import (
    DashboardEvent,
    ExecutionResultRequest,
    IntentCheckRequest,
    IntentCheckResponse,
    IntentViolation,
    VerifyRequest,
    VerifyResponse,
    Risk,
)
from scanner import scan
from auditor import audit_commands, check_intent as audit_intent
from logger import log_event

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "DEBUG").upper(),
    stream=sys.stderr,
)
logger = logging.getLogger(__name__)

app = FastAPI(title="SentinelAI Verifier")

AGENT_ID = os.environ.get("AGENT_ID", "copilot-default")


def _emit(event: DashboardEvent) -> None:
    print(event.model_dump_json(), flush=True)


@app.post("/check-intent")
async def check_intent_endpoint(body: IntentCheckRequest) -> JSONResponse:
    violations = await audit_intent(body.trace)

    status = "BLOCKED" if violations else "APPROVED"

    if status == "BLOCKED":
        event = DashboardEvent(
            event_type="intent_blocked",
            request_id=body.id,
            agent_id=AGENT_ID,
            trace=body.trace,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
        _emit(event)
        sig = await log_event(event.model_dump())
        if sig:
            event.solana_signature = sig

    response = IntentCheckResponse(id=body.id, status=status, violations=violations)
    return JSONResponse(content=response.model_dump())


@app.post("/verify")
async def verify_endpoint(body: VerifyRequest) -> JSONResponse:
    # Regex scan (hard gate)
    regex_risks = scan(body.commands)

    # Gemini audit (soft enrichment — errors treated as zero violations)
    gemini_risks = await audit_commands(body.commands, body.trace)

    all_risks = regex_risks + [r for r in gemini_risks if r.command not in {x.command for x in regex_risks}]

    if not all_risks:
        response_dict = {"status": "VALIDATED", "id": body.id}
    elif len(all_risks) == 1:
        response_dict = {"status": "SINGLE_RISK", "id": body.id, "risk": all_risks[0].model_dump()}
    else:
        response_dict = {"status": "MULTIPLE_RISKS", "id": body.id, "risks": [r.model_dump() for r in all_risks]}

    if all_risks:
        for risk in all_risks:
            event = DashboardEvent(
                event_type="risk_detected",
                request_id=body.id,
                agent_id=AGENT_ID,
                command=risk.command,
                risk=risk,
                trace=body.trace,
                timestamp=datetime.now(timezone.utc).isoformat(),
            )
            _emit(event)
            await log_event(event.model_dump())

    return JSONResponse(content=response_dict)


@app.post("/execution-result")
async def execution_result_endpoint(body: ExecutionResultRequest) -> JSONResponse:
    event_type = "human_approved" if body.approved else "human_denied"
    event = DashboardEvent(
        event_type=event_type,
        request_id=body.id,
        agent_id=body.agent_id,
        command=body.command,
        trace=body.trace,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
    _emit(event)
    sig = await log_event(event.model_dump())
    if sig:
        event.solana_signature = sig
        _emit(event)

    return JSONResponse(content={"status": "ok"})
