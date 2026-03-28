export type Risk = {
  id: string;              // uuid
  command: string;
  reason: string;          // plain-language explanation from Gemini
  source: "regex" | "risks_md";
};

export type VerifierResponse =
  | { status: "VALIDATED" }
  | { status: "SINGLE_RISK";    risk: Risk }
  | { status: "MULTIPLE_RISKS"; risks: Risk[] };

export type PendingRequest = {
  resolve:  (approvedCommands: string[]) => void;
  reject:   (reason: string) => void;
  commands: string[];
  trace:    string;
};

export type OverridePayload = {
  id:              string;
  approvedRiskIds: string[];   // ["*"] = all approved, [] = all denied, subset = selective
};
