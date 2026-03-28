from pydantic import BaseModel
from typing import Literal, Union
from datetime import datetime


# ── Inbound from MCP gateway ──────────────────────────────────────

class VerifyRequest(BaseModel):
    id: str                          # UUID from gateway
    commands: list[str]
    trace: str                       # Copilot reasoning


# ── Risk item ────────────────────────────────────────────────────

class Risk(BaseModel):
    id: str                          # UUID, stable identifier per risk
    command: str
    reason: str                      # plain-language Gemini explanation
    source: Literal["regex", "risks_md"]


# ── Outbound to MCP gateway ───────────────────────────────────────

class ValidatedResponse(BaseModel):
    status: Literal["VALIDATED"]
    id: str


class SingleRiskResponse(BaseModel):
    status: Literal["SINGLE_RISK"]
    id: str
    risk: Risk


class MultipleRisksResponse(BaseModel):
    status: Literal["MULTIPLE_RISKS"]
    id: str
    risks: list[Risk]


VerifierResponse = Union[ValidatedResponse, SingleRiskResponse, MultipleRisksResponse]


# ── Dashboard event (structured output) ──────────────────────────
# Emitted to stdout as newline-delimited JSON (one object per line).
# Dashboard consumes this stream directly.

class DashboardEvent(BaseModel):
    event_id: str                    # UUID
    request_id: str                  # links back to the gateway request
    timestamp: datetime
    event_type: Literal[
        "risk_detected",             # emitted per risk found
        "human_approved",            # emitted when human allows action
        "human_denied",              # emitted when human blocks action
        "executed",                  # emitted when command runs
        "timeout",                   # emitted when verifier times out
    ]
    command: str
    risk: Risk | None = None         # populated for risk_detected events
    solana_tx: str | None = None     # populated after Solana log
    agent_id: str                    # identifier for the Copilot session
    reasoning_trace: str


# ── Execution result inbound ──────────────────────────────────────

class ExecutionResultRequest(BaseModel):
    request_id: str
    command: str
    approved: bool
    agent_id: str
    trace: str
