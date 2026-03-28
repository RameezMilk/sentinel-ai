import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OverridePayload, VerifierResponse } from "./types.js";
export declare function handleVerifyResult(body: VerifierResponse & {
    id: string;
}): void;
export declare function handleOverride(payload: OverridePayload): void;
export declare function startLocalHttpServer(): void;
export declare function createMcpServer(): McpServer;
export declare function startGateway(): Promise<void>;
//# sourceMappingURL=gateway.d.ts.map