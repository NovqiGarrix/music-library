import mongoose from "mongoose";
import { createApp } from "./app.ts";
import env from "./config/env.ts";

// Connect to DB first
await mongoose.connect(env.DATABASE_URL);

const httpServer = createApp();

Deno.addSignalListener('SIGINT', async () => {
  console.log('SIGINT received');
  await httpServer.shutdown();
  Deno.exit(0);
});