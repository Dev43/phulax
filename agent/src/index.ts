import { buildServer } from "./server.js";
import { config } from "./config.js";

const app = await buildServer();
await app.listen({ port: config().serverPort, host: "0.0.0.0" });
app.log.info(`phulax agent up on :${config().serverPort}`);
