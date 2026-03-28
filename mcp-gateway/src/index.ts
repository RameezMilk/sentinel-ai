import { startGateway } from "./gateway.js";

startGateway().catch((err) => {
  process.stderr.write(`[sentinelai] Fatal error: ${err}\n`);
  process.exit(1);
});
