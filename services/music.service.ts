import "@std/dotenv/load";

import { ensureDir } from '@std/fs';
import { OAuth2Client } from "google-auth-library";
import { google, youtube_v3 } from "googleapis";
import YTDlpWrap from 'yt-dlp-wrap';
import env from "../config/env.ts";
import { logger } from "../lib/logger.ts";
import { s3 } from "../lib/s3.ts";
import MusicModel from "../model/MusicModel.ts";
import { ApiError } from "../model/error.ts";
import { Document } from "mongoose";

const service = google.youtube("v3");
const ytDlpWrap = new YTDlpWrap.default();

const YT_DLP_BINARY_PATH = Deno.env.get("YT_DLP_BINARY_PATH");
const MAX_AUDIO_PER_LOOP = 5;

if (YT_DLP_BINARY_PATH) {
    ytDlpWrap.setBinaryPath(YT_DLP_BINARY_PATH);
}

function downloadAudio(channelId: string, audioId: string, audioTitle: string) {
    console.log('Trying to download the audio...: ', audioTitle);

    const videoURL = `https://www.youtube.com/watch?v=${audioId}`;
    return new Promise<string>((resolve, reject) => {
        const output = `musics/${channelId}/${audioTitle}.opus`;

        const customCookies = env.COOKIES_FILE_PATH;

        const execOptions = [
            videoURL,
            '-f', 'ba',
            '-x',
            '--audio-format', 'opus',
            '--audio-quality', '0',
            '--embed-metadata',
            // '--embed-thumbnail',
            '--force-overwrite',
            '-o', output
        ];

        if (customCookies) {
            execOptions.push('--cookies', customCookies);
        }

        if (env.FFMPEG_LOCATION) {
            execOptions.push('--ffmpeg-location', env.FFMPEG_LOCATION);
        }

        ytDlpWrap.exec(execOptions).on('progress', (progress) => {
            console.log(`-- ${audioTitle}: ${progress.percent}%`);
        }).on('close', (code) => {
            console.log(`-- ${audioTitle}: Finished with code ${code}`);
            resolve(output);
        }).once('error', (e) => {
            console.error(e);
            logger.error(`-- ${audioTitle}: Failed with error:`, e);
            reject(e);
        });
    })
}

async function downloadAndStore(audio: youtube_v3.Schema$Video) {

    // Check if audio already exist in database
    const existedAudio = await MusicModel.findOne({ id: audio.id! }, { id: 1, streamUri: 1 });
    if (existedAudio) {
        logger.info(`Audio: ${audio.snippet?.title} - ${audio.id} already existed!`);
        return existedAudio;
    }

    const videoTitle = audio.snippet?.title!;
    const channelTitle = audio.snippet?.channelTitle!;
    const channelId = audio.snippet?.channelId!;

    const audioId = audio.id!;

    // Setup upload path format (same as what we'll use when uploading)
    const filename = `${videoTitle.replaceAll("/", "_").replaceAll(" ", "")}.opus`;
    const uploadedPath = `${channelTitle}/${filename}`;
    const expectedStreamUri = `https://music-library-r2.nvhub.my.id/${uploadedPath}`;

    // Check if this exact file already exists in the database (by streamUri)
    const existingByUri = await MusicModel.findOne({ streamUri: expectedStreamUri });
    if (existingByUri) {
        logger.info(`Audio file for ${videoTitle} already exists in storage at ${expectedStreamUri}`);

        // If we found the file in storage but with a different ID, update our database
        if (existingByUri.id !== audioId) {
            logger.info(`Updating database record for ${videoTitle} with correct ID`);
            await MusicModel.updateOne(
                { streamUri: expectedStreamUri },
                { id: audioId, snippet: audio.snippet, contentDetails: audio.contentDetails }
            );
        }

        return (await MusicModel.findOne({ streamUri: expectedStreamUri }))!;
    }

    // Download the audio since it doesn't exist in storage
    const downloadedPath = await downloadAudio(channelId, audioId, videoTitle);
    const audioFile = await Deno.readFile(downloadedPath);

    // Upload to S3 and cleanup
    await s3.write(uploadedPath, audioFile);
    await Deno.remove(downloadedPath);

    // Save the record to the database
    const music = await MusicModel.findOneAndUpdate({
        id: audioId,
    }, {
        id: audioId,
        snippet: audio.snippet,
        streamUri: expectedStreamUri,
        contentDetails: audio.contentDetails
    }, {
        upsert: true,
        new: true,
    });

    return music;
}

export async function downloadAndStoreVideosByPlaylistId(auth: OAuth2Client, playlistId: string) {
    await ensureDir(`musics/${playlistId}`);

    let videoNextPageToken: string | undefined = undefined;
    let allProcessedVideos: Array<Document> = [];

    do {
        const { data: playlistVideos }: { data: youtube_v3.Schema$PlaylistItemListResponse } = await service.playlistItems.list({
            auth,
            playlistId,
            part: ["snippet"],
            maxResults: 50,
            pageToken: videoNextPageToken,
            fields: "nextPageToken, items(id, snippet)",
        });

        videoNextPageToken = playlistVideos.nextPageToken ?? undefined;

        for (let index = 0; index < playlistVideos.items?.length!; index += MAX_AUDIO_PER_LOOP) {
            const slicedPlaylistItems = playlistVideos.items!.slice(index, index + MAX_AUDIO_PER_LOOP);

            // Extract video IDs from playlist items
            const videoIds = slicedPlaylistItems
                .map(item => item.snippet?.resourceId?.videoId)
                .filter(id => id) as string[];

            if (videoIds.length === 0) continue;

            // Fetch the complete video details
            const { data: videos } = await service.videos.list({
                auth,
                id: videoIds,
                part: ["snippet", "contentDetails"],
                fields: "items(id, snippet, contentDetails)",
                maxResults: 50,
                videoCategoryId: "10"
            });

            try {
                // Process each video and collect results without returning early
                const processedBatch = await Promise.all(videos.items?.map(downloadAndStore) || []);
                allProcessedVideos = allProcessedVideos.concat(processedBatch.filter(Boolean));
            } catch (error) {
                console.error('Error downloading videos:', error);
                // Continue to next batch instead of returning
            }
        }
    } while (videoNextPageToken);

    return allProcessedVideos;
}

export async function downloadAndStoreVideosByChannelHandle(auth: OAuth2Client, channelHandle: string) {
    const { data: channels } = await service.channels.list({
        auth,
        forHandle: channelHandle,
        part: ["contentDetails", "snippet"],
    });

    if (!channels.items?.length) {
        throw new ApiError(404).setError(`No channel found with handle: ${channelHandle}`);
    }

    const channel = channels.items[0];

    const playlistId = channel.contentDetails?.relatedPlaylists?.uploads;

    if (!playlistId) {
        throw new ApiError(404).setError(`No uploads playlist found for channel: ${channel.snippet?.title}`);
    }

    await downloadAndStoreVideosByPlaylistId(auth, playlistId);
}

interface GetNextMusicsParams {
    page: number;
    limit: number;
    currentId: string;
    channelTitle: string;
    fields?: string;
}

/**
 * 
 * @param params GetNextMusicsParams
 * @returns Few next musics from the same channel
 */
export async function getNextMusics(params: GetNextMusicsParams) {

    const { page, limit, fields, currentId, channelTitle } = params;

    // Calculate skip value for pagination
    const skip = (page - 1) * limit;
    const projection = parseFieldsToProjection(fields);

    const [musics, total] = await Promise.all([
        MusicModel.find({
            "snippet.channelTitle": channelTitle,
            id: { $ne: currentId }
        }, projection)
            .limit(limit)
            .skip(skip)
            .lean(),
        MusicModel.countDocuments({ "snippet.channelTitle": channelTitle })
    ]);

    return {
        musics,
        pagination: {
            totalItems: total,
            currentPage: page,
            pageSize: limit,
            totalPages: Math.ceil(total / limit),
        },
    }

}

// New function to download and store a single YouTube video
export async function downloadAndStoreSingleVideo(auth: OAuth2Client, videoId: string) {

    // Check if the music is existed
    const music = await MusicModel.findOne({ id: videoId }).lean();
    if (music) {
        return music;
    }

    // Fetch video details using YouTube API
    const { data: videoRes } = await service.videos.list({
        auth,
        id: [videoId],
        part: ["snippet", "contentDetails"],
    });

    if (!videoRes.items?.length) {
        throw new ApiError(404).setError("Video not found");
    }

    const video = videoRes.items[0];

    return downloadAndStore(video);
}

interface PaginationOptions {
    page: number;
    limit: number;
}

/**
 * Gets a paginated list of musics with optional text search
 * @param page The page number (starts from 1)
 * @param limit The number of items per page
 * @param searchKeyword Optional search term for title and channel title
 * @returns Music items and pagination metadata
 */
// Interface for the getMusics function parameters
export type GetMusicsParams = {
    searchKeyword?: string;
    fields?: string; // Add fields parameter for selecting specific fields
} & PaginationOptions;

/**
 * Converts dot notation field paths to MongoDB projection object
 * @param fields Comma-separated list of fields in dot notation
 * @returns MongoDB projection object
 */
function parseFieldsToProjection(fields?: string): Record<string, number> {
    // Default fields to return if none specified
    const defaultFields = {
        "_id": 1,
        "id": 1,
        "snippet.title": 1,
        "snippet.channelTitle": 1,
        "snippet.thumbnails.standard": 1,
        "contentDetails": 1,
        "streamUri": 1,
    };

    // If no fields specified, return default projection
    if (!fields || !fields.trim()) {
        return defaultFields;
    }

    // Create projection object from specified fields
    const projection: Record<string, number> = {};
    const fieldArray = fields.split(',').map(f => f.trim());

    // Add each field to projection
    for (const field of fieldArray) {
        if (field) {
            projection[field] = 1;
        }
    }

    // Always include _id unless explicitly excluded
    if (!('_id' in projection) && !('-_id' in projection)) {
        projection['_id'] = 1;
    }

    return projection;
}

/**
 * Gets a paginated list of musics with optional text search
 * @param params Object containing pagination and search parameters
 * @returns Music items and pagination metadata
 */
export async function getMusics(params: GetMusicsParams) {
    const { page, limit, searchKeyword = '', fields } = params;

    // Calculate skip value for pagination
    const skip = (page - 1) * limit;

    // Build query
    let query: Record<string, unknown> = {};

    // Add text search if searchKeyword is provided
    if (searchKeyword.trim()) {
        try {
            query = {
                $text: { $search: searchKeyword },
            }
        } catch (error) {
            logger.error("Error creating text index:", error);
            // Continue with empty query if index creation fails
        }
    }

    // Parse field selection into MongoDB projection
    const projection = parseFieldsToProjection(fields);

    // Execute query with pagination and field projection and count in parallel
    const [musics, total] = await Promise.all([
        MusicModel
            .find(query, projection)
            .sort({ createdAt: -1, id: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        MusicModel.countDocuments(query)
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
        musics,
        pagination: {
            totalItems: total,
            currentPage: page,
            pageSize: limit,
            totalPages,
            nextPage: page < totalPages ? page + 1 : null,
        },
    }
}

/**
 * Gets a single track by its ID
 * @param videoId videoId not playlistItem ID
 * @param googleAuth Google OAuth2Client for authentication
 * @param fields Optional dot notation fields to include in the response
 * @returns The track data or throws a 404 error if not found
 */
export async function getTrackById(videoId: string, googleAuth: OAuth2Client, fields?: string) {
    const projection = parseFieldsToProjection(fields);

    const track = await MusicModel.findOne({ id: videoId }, projection).lean();

    if (!track) {
        await downloadAndStoreSingleVideo(googleAuth, videoId);
        return (await MusicModel.findOne({ id: videoId }, projection).lean())!;
    }

    return track;
}

/**
 * Search YouTube videos using the YouTube API
 * @param auth OAuth2Client for authentication
 * @param query Search query string
 * @param pageToken Optional token for pagination
 * @param maxResults Optional maximum number of results (default: 25, max: 50)
 * @returns YouTube search results
 */
export interface SearchYouTubeVideosParams {
    auth: OAuth2Client;
    query: string;
    pageToken?: string;
    maxResults?: number;
}

export async function searchYouTubeVideos(params: SearchYouTubeVideosParams) {
    const { auth, query, pageToken, maxResults = 50 } = params;

    const { data } = await service.search.list({
        auth,
        q: query,
        part: ["snippet"],
        type: ["video"],
        maxResults,
        pageToken,
        fields: "nextPageToken,prevPageToken,items(id,snippet)"
    });

    return {
        items: data.items,
        nextPageToken: data.nextPageToken,
        prevPageToken: data.prevPageToken
    }
}

export async function mockSearchResults(auth: OAuth2Client) {

    const { data } = await service.videos.list({
        auth,
        part: ["snippet"],
        fields: "items(id,snippet)",
        id: ["dQw4w9WgXcQ", "dQw4w9WgXcQ", "dQw4w9WgXcQ", "dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    });

    return data;

}

/**
 * Gets the next track by the current track ID
 * @param currentTrackId The ID of the current track
 * @param channelTitle Optional channel title to limit results to the same channel
 * @param fields Optional dot notation fields to include in the response
 * @returns The next track or null if there isn't one
 */
export async function getNextTrack(currentTrackId: string, channelTitle?: string, fields?: string) {
    const projection = parseFieldsToProjection(fields);

    const query: Record<string, unknown> = { id: { $ne: currentTrackId } };

    // If channelTitle is provided, limit to the same channel
    if (channelTitle) {
        query["snippet.channelTitle"] = channelTitle;
    }

    // Find the current track to get its creation timestamp
    const currentTrack = await MusicModel.findOne({ id: currentTrackId }).lean();
    if (!currentTrack) {
        throw new ApiError(404).setError(`Track with ID ${currentTrackId} not found`);
    }

    // Find the next track (created after the current track)
    let nextTrack = await MusicModel.findOne(
        {
            ...query,
            _id: { $gt: currentTrack._id }
        },
        projection
    )
        .sort({ _id: 1 })
        .lean();

    // If no next track in the same direction, wrap around to the first track
    if (!nextTrack) {
        nextTrack = await MusicModel.findOne(query, projection)
            .sort({ _id: 1 })
            .lean();
    }

    return nextTrack;
}

/**
 * Gets the previous track by the current track ID
 * @param currentTrackId The ID of the current track
 * @param channelTitle Optional channel title to limit results to the same channel
 * @param fields Optional dot notation fields to include in the response
 * @returns The previous track or null if there isn't one
 */
export async function getPreviousTrack(currentTrackId: string, channelTitle?: string, fields?: string) {
    const projection = parseFieldsToProjection(fields);

    const query: Record<string, unknown> = { id: { $ne: currentTrackId } };

    // If channelTitle is provided, limit to the same channel
    if (channelTitle) {
        query["snippet.channelTitle"] = channelTitle;
    }

    // Find the current track to get its creation timestamp
    const currentTrack = await MusicModel.findOne({ id: currentTrackId }).lean();
    if (!currentTrack) {
        throw new ApiError(404).setError(`Track with ID ${currentTrackId} not found`);
    }

    // Find the previous track (created before the current track)
    let previousTrack = await MusicModel.findOne(
        {
            ...query,
            _id: { $lt: currentTrack._id }
        },
        projection
    )
        .sort({ _id: -1 })
        .lean();

    // If no previous track, wrap around to the last track
    if (!previousTrack) {
        previousTrack = await MusicModel.findOne(query, projection)
            .sort({ _id: -1 })
            .lean();
    }

    return previousTrack;
}

/**
 * Gets all unique channels with pagination
 * @param page The page number (starts from 1)
 * @param limit The number of items per page
 * @returns Unique channels (channelId and channelTitle) and pagination metadata
 */
export async function getChannels(page: number, limit: number) {
    // Calculate skip value for pagination
    const skip = (page - 1) * limit;

    // Use aggregation to get unique channels
    const channels = await MusicModel.aggregate([
        // Group by channelId and get the first channelTitle for each
        {
            $group: {
                _id: "$snippet.channelId",
                channelId: { $first: "$snippet.channelId" },
                channelTitle: { $first: "$snippet.channelTitle" },
                count: { $sum: 1 } // Count tracks per channel
            }
        },
        // Sort by channel title alphabetically
        { $sort: { channelTitle: 1 } },
        // Skip for pagination
        { $skip: skip },
        // Limit results
        { $limit: limit },
        // Project only the fields we want
        {
            $project: {
                _id: 0,
                channelId: 1,
                channelTitle: 1,
                trackCount: "$count"
            }
        }
    ]);

    // Count total unique channels for pagination
    const totalChannelsResult = await MusicModel.aggregate([
        {
            $group: {
                _id: "$snippet.channelId"
            }
        },
        {
            $count: "total"
        }
    ]);

    const total = totalChannelsResult.length > 0 ? totalChannelsResult[0].total : 0;
    const totalPages = Math.ceil(total / limit);

    return {
        channels,
        pagination: {
            totalItems: total,
            currentPage: page,
            pageSize: limit,
            totalPages,
            nextPage: page < totalPages ? page + 1 : null,
        }
    };
}