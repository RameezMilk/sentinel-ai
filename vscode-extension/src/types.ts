export type Risk = {
  id: string;
  command: string;
  reason: string;
  source: "regex" | "risks_md";
};

export type IntentViolation = {
  subject: string;
  reason: string;
  policy_excerpt: string;
};

export type CheckIntentResponse = {
  id: string;
  status: "APPROVED" | "BLOCKED";
  violations: IntentViolation[];
};

export type VerifierResponse =
  | { status: "VALIDATED"; id: string }
  | { status: "SINGLE_RISK"; id: string; risk: Risk }
  | { status: "MULTIPLE_RISKS"; id: string; risks: Risk[] };
