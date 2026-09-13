import { createHostedConsoleServer } from "./app.js";

const adminToken = process.env.RELAY_ADMIN_TOKEN;
if (!adminToken || adminToken.length < 16) {
  console.error("Set a 16+ character RELAY_ADMIN_TOKEN before starting the hosted console.");
  process.exit(1);
}

const port = Number(process.env.PORT || 8787);
const server = createHostedConsoleServer({ adminToken });
server.listen(port, "127.0.0.1", () => {
  console.log(`WGW Relay hosted console listening on http://127.0.0.1:${port}`);
});
