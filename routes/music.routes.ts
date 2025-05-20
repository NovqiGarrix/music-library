import { Hono } from "@hono/hono";
import { logger } from "../lib/logger.ts";
import { ApiError } from "../model/error.ts";
import {
    downloadAndStoreSingleVideo,
    downloadAndStoreVideosByChannelHandle,
    downloadAndStoreVideosByPlaylistId,
    getChannels,
    getMusics,
    getNextMusics,
    getTrackById,
    getNextTrack,
    getPreviousTrack,
    mockSearchResults,
    searchYouTubeVideos,
    getNextTrackByCreatedAt,
} from "../services/music.service.ts";
import { Bindings } from "../types.ts";

const musicRoutes = new Hono<{ Bindings: Bindings }>();

// Updated route with noun-based endpoint for creating a new track
musicRoutes.post("/track_by_video", async (c) => {
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
        const music = await downloadAndStoreSingleVideo(c.env.auth, videoId);
        return c.json({ data: music });
    } catch (e) {
        if (!(e instanceof ApiError)) {
            logger.error(`/tracks_by_video`);
            console.error(e);
        }
        return ApiError.internalServerError().toResponse(c);
    }
});

musicRoutes.post("/tracks_by_channel_handle", async (c) => {
    const { channelHandle } = await c.req.json();

    try {
        await downloadAndStoreVideosByChannelHandle(c.env.auth, channelHandle);
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
        await downloadAndStoreVideosByPlaylistId(c.env.auth, playlistId);
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

        const track = await getTrackById(id, c.env.auth, fields);

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

// Route to get the next track after the current one
musicRoutes.get("/tracks/:id/next", async (c) => {
    try {
        const id = c.req.param('id');
        const { channelTitle, fields } = c.req.query();

        const nextTrack = await getNextTrack(id, channelTitle, fields);

        if (!nextTrack) {
            return new ApiError(404).setError("No next track found").toResponse(c);
        }

        return c.json({
            status: "OK",
            data: nextTrack
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return error.toResponse(c);
        }

        logger.error(`Error fetching next track:`, error);
        return new ApiError(500).setError("Failed to fetch next track").toResponse(c);
    }
});

// Route to get the previous track before the current one
musicRoutes.get("/tracks/:id/previous", async (c) => {
    try {
        const id = c.req.param('id');
        const { channelTitle, fields } = c.req.query();

        const previousTrack = await getPreviousTrack(id, channelTitle, fields);

        if (!previousTrack) {
            return new ApiError(404).setError("No previous track found").toResponse(c);
        }

        return c.json({
            status: "OK",
            data: previousTrack
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return error.toResponse(c);
        }

        logger.error(`Error fetching previous track:`, error);
        return new ApiError(500).setError("Failed to fetch previous track").toResponse(c);
    }
});

// New route to get the next track sorted by createdAt
musicRoutes.get("/tracks/:id/next_track", async (c) => {
    try {
        const id = c.req.param('id');
        const nextTrack = await getNextTrackByCreatedAt(id);

        if (!nextTrack) {
            return new ApiError(404).setError("No next track found").toResponse(c);
        }

        return c.json({
            status: "OK",
            data: nextTrack
        });
    } catch (error) {
        if (error instanceof ApiError) {
            return error.toResponse(c);
        }

        logger.error(`Error fetching next track by createdAt:`, error);
        return new ApiError(500).setError("Failed to fetch next track by createdAt").toResponse(c);
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

// Route to search YouTube videos
musicRoutes.get("/search", async (c) => {
    try {
        const { q, pageToken, maxResults } = c.req.query();

        if (!q) {
            return new ApiError(400).setError("Search query is required").toResponse(c);
        }

        const results = await searchYouTubeVideos({
            auth: c.env.auth,
            query: q,
            pageToken,
            maxResults: maxResults ? Number(maxResults) : undefined
        });

        return c.json({
            status: "OK",
            data: results
        });
    } catch (error) {
        if (!(error instanceof ApiError)) {
            logger.error("Error searching videos:");
            console.error(error);
        }
        return new ApiError(500).setError("Failed to search videos").toResponse(c);
    }
});

musicRoutes.get("/mock_search", async (c) => {

    try {

        const results = await mockSearchResults(c.env.auth);

        return c.json({
            status: "OK",
            data: results
        });

    } catch (error) {
        if (!(error instanceof ApiError)) {
            logger.error("Error searching videos:");
            console.error(error);
        }
        return new ApiError(500).setError("Failed to search videos").toResponse(c);
    }

})

// Route to get next musics from the same channel
musicRoutes.get("/next", async (c) => {
    try {
        const { page, limit, currentId, fields } = c.req.query();

        // Convert query params to numbers with defaults
        const pageNumber = page ? Number(page) : 1;
        const limitNumber = limit ? Number(limit) : 20;

        // Validate required parameters
        if (!currentId) {
            return new ApiError(400).setError("currentId and channelTitle are required").toResponse(c);
        }

        // Validate pagination parameters
        if (isNaN(pageNumber) || pageNumber < 1) {
            return new ApiError(400).setError("Invalid page parameter").toResponse(c);
        }

        if (isNaN(limitNumber) || limitNumber < 1) {
            return new ApiError(400).setError("Invalid limit parameter").toResponse(c);
        }

        const result = await getNextMusics({
            page: pageNumber,
            limit: limitNumber,
            currentId,
            fields
        });

        return c.json({
            status: "OK",
            data: result.musics,
            pagination: result.pagination
        });
    } catch (error) {
        if (!(error instanceof ApiError)) {
            logger.error("Error fetching next musics:");
            console.error(error);
        }
        return new ApiError(500).setError("Failed to fetch next musics").toResponse(c);
    }
});

// New route to get all channels with pagination
musicRoutes.get("/channels", async (c) => {
    try {
        const { page, limit } = c.req.query();

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

        const result = await getChannels(pageNumber, limitNumber);

        return c.json({
            status: "OK",
            data: result.channels,
            pagination: result.pagination
        });
    } catch (error) {
        if (!(error instanceof ApiError)) {
            logger.error("Error fetching channels:", error);
        }
        return new ApiError(500).setError("Failed to fetch channels").toResponse(c);
    }
});

export default musicRoutes;
