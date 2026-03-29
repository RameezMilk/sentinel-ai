from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel


class VerifyRequest(BaseModel):
    id: str
    commands: list[str]
    trace: str


class Risk(BaseModel):
    id: str
    command: str
    reason: str
    source: str  # "regex" for pattern matches, or the policy filename e.g. "RISKS.md"


class VerifyResponse(BaseModel):
    status: Literal["VALIDATED", "SINGLE_RISK", "MULTIPLE_RISKS"]
    id: str
    risk: Optional[Risk] = None
    risks: Optional[list[Risk]] = None


class IntentCheckRequest(BaseModel):
    id: str
    trace: str


class IntentViolation(BaseModel):
    id: str
    subject: str
    reason: str
    policy_excerpt: str
    source_file: str  # the policy filename in risks/ that contains the violated rule, e.g. "RISKS.md"


class IntentCheckResponse(BaseModel):
    id: str
    status: Literal["APPROVED", "BLOCKED"]
    violations: list[IntentViolation] = []


class IntentResultRequest(BaseModel):
    id: str  # prompt UID
    trace: str
    decision: Literal["accepted", "rejected"]
    violations: list[IntentViolation]


class ExecutionResultRequest(BaseModel):
    id: str
    command: str
    approved: bool
    agent_id: str
    trace: str


class DashboardEvent(BaseModel):
    event_type: Literal[
        "risk_detected",
        "human_approved",
        "human_denied",
        "executed",
        "timeout",
        "intent_blocked",
    ]
    request_id: str
    agent_id: str
    command: Optional[str] = None
    risk: Optional[Risk] = None
    trace: Optional[str] = None
    solana_signature: Optional[str] = None
    timestamp: Optional[str] = None
