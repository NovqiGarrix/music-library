import "@std/dotenv/load";

import { Hono } from '@hono/hono';
import { cors } from '@hono/hono/cors';
import { logger as honoLogger } from '@hono/hono/logger';
import { swaggerUI } from '@hono/swagger-ui';
import { OAuth2Client } from "google-auth-library";
import env from "./config/env.ts";
import { honoLogPrintFunc, logger } from "./lib/logger.ts";
import musicRoutes from "./routes/music.routes.ts";
import { Bindings } from "./types.ts";

// Import the OpenAPI schema
import apiSchema from './api.json' with { type: "json" };

export function createApp() {

    const auth = new OAuth2Client({
        apiKey: env.GOOGLE_API_KEY
    });

    const app = new Hono<{ Bindings: Bindings }>();
    app.use(honoLogger(honoLogPrintFunc));
    app.use(cors());

    // Mount the Swagger UI
    // @ts-expect-error - Mismatch type
    app.use('/docs/*', swaggerUI({
        spec: apiSchema,
        url: '/docs',
    }));

    app.get('/', (c) => {
        return c.json({ message: 'Hello World' }, 200);
    });

    app.get('/health_check', (c) => {
        return c.json({ status: 'OK' }, 200);
    });

    app.use(async (c, next) => {
        c.env.auth = auth;
        await next();
    });

    app.route('/api/v1/musics', musicRoutes);

    const httpServer = Deno.serve({
        port: 4000,
        onListen({ port }) {
            logger.info(`Listening on http://localhost:${port}`);
            logger.info(`API Documentation available at http://localhost:${port}/docs`);
        }
    }, app.fetch);

    return httpServer;

}