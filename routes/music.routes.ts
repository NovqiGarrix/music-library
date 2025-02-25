import { Hono } from "@hono/hono";
import { googleAuth } from "../lib/google-auth.ts";
import { logger } from "../lib/logger.ts";
import { ApiError } from "../model/error.ts";
import {
    downloadAndStoreSingleVideo,
    downloadAndStoreVideosByChannelHandle,
    downloadAndStoreVideosByPlaylistId,
    getMusics,
    getTrackById
} from "../services/music.service.ts";
import { Bindings } from "../types.ts";

const musicRoutes = new Hono<{ Bindings: Bindings }>();

// Updated route with noun-based endpoint for creating a new track
musicRoutes.post("/tracks_by_video", async (c) => {
    const { url } = await c.req.json();
    let videoId = "";

    // Extract video id from a YouTube URL or use the provided id directly
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
        const vParam = url.match(/[?&]v=([^&]+)/);
        if (vParam) {
            videoId = vParam[1];
        } else {
            const shortMatch = url.match(/youtu\.be\/([^?&]+)/);
            if (shortMatch) {
                videoId = shortMatch[1];
            }
        }
    } else {
        videoId = url;
    }

    if (!videoId) {
        return c.json({ error: "Invalid URL or video id." }, 400);
    }

    try {
        await downloadAndStoreSingleVideo(googleAuth, videoId);
        return c.json({ message: "Track created successfully" });
    } catch (e) {
        logger.error(`Error creating track`, e);
        return ApiError.internalServerError().toResponse(c);
    }
});

musicRoutes.post("/tracks_by_channel_handle", async (c) => {
    const { channelHandle } = await c.req.json();

    try {
        await downloadAndStoreVideosByChannelHandle(googleAuth, channelHandle);
        return c.json({ message: "Tracks created successfully" });
    } catch (e) {
        if (!(e instanceof ApiError)) {
            logger.error(`/tracks_by_channel_handle`, e);
        }
        return ApiError.internalServerError().toResponse(c);
    }
});

// New route to handle tracks by playlist id
musicRoutes.post("/tracks_by_playlist", async (c) => {
    const { playlistId } = await c.req.json();
    if (!playlistId) {
        return c.json({ error: "playlistId is required" }, 400);
    }
    try {
        await downloadAndStoreVideosByPlaylistId(googleAuth, playlistId);
        return c.json({ message: "Tracks created successfully" });
    } catch (e) {
        if (!(e instanceof ApiError)) {
            logger.error(`/tracks_by_playlist`, e);
        }
        return ApiError.internalServerError().toResponse(c);
    }
});

// New route to get a single track by ID
musicRoutes.get("/tracks/:id", async (c) => {
    try {
        const id = c.req.param('id');
        const { fields } = c.req.query();

        const track = await getTrackById(id, fields);

        return c.json({
            status: "OK",
            data: track
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return error.toResponse(c);
        }

        logger.error(`Error fetching track:`, error);
        return new ApiError(500).setError("Failed to fetch track").toResponse(c);
    }
});

// Updated GET route to support field selection
musicRoutes.get("/", async (c) => {
    try {
        const { page, limit, search, fields } = c.req.query();

        // Convert query params to numbers with defaults
        const pageNumber = page ? Number(page) : 1;
        const limitNumber = limit ? Number(limit) : 20;

        // Validate pagination parameters
        if (isNaN(pageNumber) || pageNumber < 1) {
            return new ApiError(400).setError("Invalid page parameter").toResponse(c);
        }

        if (isNaN(limitNumber) || limitNumber < 1) {
            return new ApiError(400).setError("Invalid limit parameter").toResponse(c);
        }

        const result = await getMusics({
            page: pageNumber,
            limit: limitNumber,
            searchKeyword: search,
            fields: fields
        });

        return c.json({
            status: "OK",
            data: result.musics,
            pagination: result.pagination
        });
    } catch (error) {
        if (!(error instanceof ApiError)) {
            logger.error("Error fetching musics:", error);
        }
        return new ApiError(500).setError("Failed to fetch musics").toResponse(c);
    }
});

export default musicRoutes;
