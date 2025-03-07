import { assertEquals } from '@std/assert';
import '@std/dotenv/load';
import { OAuth2Client } from "google-auth-library";
import mongoose from 'mongoose';
import { createApp } from '../app.ts';
import env from "../config/env.ts";
import MusicModel from "../model/MusicModel.ts";

const mockTracks = [
    // Track 1
    {
        id: "track1",
        snippet: {
            title: "Track 1",
            channelTitle: "Test Channel",
            publishedAt: new Date(),
            channelId: "channel1",
            thumbnails: {
                default: { url: "https://example.com/thumb.jpg", width: 120, height: 90 }
            },
            description: "Test Track 1"
        },
        streamUri: "https://example.com/track1.mp3"
    },
    // Track 2
    {
        id: "track2",
        snippet: {
            title: "Track 2",
            channelTitle: "Test Channel",
            publishedAt: new Date(),
            channelId: "channel1",
            thumbnails: {
                default: { url: "https://example.com/thumb.jpg", width: 120, height: 90 }
            },
            description: "Test Track 2"
        },
        streamUri: "https://example.com/track2.mp3"
    },
    // Track 3 (different channel)
    {
        id: "track3",
        snippet: {
            title: "Track 3",
            channelTitle: "Another Channel",
            publishedAt: new Date(),
            channelId: "channel2",
            thumbnails: {
                default: { url: "https://example.com/thumb.jpg", width: 120, height: 90 }
            },
            description: "Test Track 3"
        },
        streamUri: "https://example.com/track3.mp3"
    }
];

// Create a test app with our music routes
const app = createApp();

// Mock environment for Hono context
const mockEnv = {
    auth: new OAuth2Client({
        apiKey: env.GOOGLE_API_KEY
    })
};

Deno.test("Music Routes API Tests", async (t) => {
    await mongoose.connect(env.DATABASE_URL);

    // Clean up test data before tests
    await MusicModel.deleteMany({
        id: { $in: mockTracks.map(track => track.id) }
    });

    // Insert test tracks
    await MusicModel.create(mockTracks);

    await t.step("GET /api/v1/musics/tracks/:id/next - should get next track", async () => {
        const req = new Request(`http://localhost:${env.PORT}/api/v1/musics/tracks/track1/next`);
        const res = await app.fetch(req, { env: mockEnv });
        const data = await res.json();

        assertEquals(res.status, 200);
        assertEquals(data.status, "OK");
        assertEquals(data.data.id, "track2");
    });

    await t.step("GET /api/v1/musics/tracks/:id/next - should filter by channel", async () => {
        const req = new Request(`http://localhost:${env.PORT}/api/v1/musics/tracks/track1/next?channelTitle=Test%20Channel`);
        const res = await app.fetch(req, { env: mockEnv });
        const data = await res.json();

        assertEquals(res.status, 200);
        assertEquals(data.status, "OK");
        assertEquals(data.data.id, "track2");
        assertEquals(data.data.snippet.channelTitle, "Test Channel");
    });

    await t.step("GET /api/v1/musics/tracks/:id/next - should return 404 for non-existent track", async () => {
        const req = new Request(`http://localhost:${env.PORT}/api/v1/musics/tracks/nonexistent-track/next`);
        const res = await app.fetch(req, { env: mockEnv });
        const data = await res.json();

        assertEquals(res.status, 404);
        assertEquals(typeof data.error, "string");
    });

    await t.step("GET /api/v1/musics/tracks/:id/previous - should get previous track", async () => {
        const req = new Request(`http://localhost:${env.PORT}/api/v1/musics/tracks/track2/previous`);
        const res = await app.fetch(req, { env: mockEnv });
        const data = await res.json();

        assertEquals(res.status, 200);
        assertEquals(data.status, "OK");
        assertEquals(data.data.id, "track1");
    });

    await t.step("GET /api/v1/musics/tracks/:id/previous - should filter by channel", async () => {
        const req = new Request(`http://localhost:${env.PORT}/api/v1/musics/tracks/track2/previous?channelTitle=Test%20Channel`);
        const res = await app.fetch(req, { env: mockEnv });
        const data = await res.json();

        assertEquals(res.status, 200);
        assertEquals(data.status, "OK");
        assertEquals(data.data.id, "track1");
        assertEquals(data.data.snippet.channelTitle, "Test Channel");
    });

    await t.step("GET /api/v1/musics/tracks/:id/previous - should return 404 for non-existent track", async () => {
        const req = new Request(`http://localhost:${env.PORT}/api/v1/musics/tracks/nonexistent-track/previous`);
        const res = await app.fetch(req, { env: mockEnv });
        const data = await res.json();

        assertEquals(res.status, 404);
        assertEquals(typeof data.error, "string");
    });

    // Clean up test data
    await MusicModel.deleteMany({
        id: { $in: mockTracks.map(track => track.id) }
    });

    // Close all connections in the connection pool
    for await (const connection of mongoose.connections) {
        await connection.destroy(true);
    }

});
