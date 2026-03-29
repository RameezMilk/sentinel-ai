export type Risk = {
  id: string;
  command: string;
  reason: string;
  source: string; // "regex" for pattern matches, or the policy filename e.g. "RISKS.md"
};

export type IntentViolation = {
  id: string;
  subject: string;
  reason: string;
  policy_excerpt: string;
  source_file: string; // policy filename in risks/ that contains the violated rule, e.g. "RISKS.md"
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
