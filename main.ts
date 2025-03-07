import mongoose from "mongoose";
import { createApp } from "./app.ts";
import env from "./config/env.ts";
import { logger } from "./lib/logger.ts";

// Connect to DB first
await mongoose.connect(env.DATABASE_URL);

const app = createApp();

const httpServer = Deno.serve({
  port: env.PORT,
  onListen({ port }) {
    logger.info(`Listening on http://localhost:${port}`);
    logger.info(`API Documentation available at http://localhost:${port}/docs`);
  }
}, app.fetch);

Deno.addSignalListener('SIGINT', async () => {
  console.log('SIGINT received');
  await httpServer.shutdown();
  Deno.exit(0);
});