import "@std/dotenv/load";

import { ensureDir } from '@std/fs';
import { OAuth2Client } from "google-auth-library";
import { google, youtube_v3 } from "googleapis";
import YTDlpWrap from 'yt-dlp-wrap';
import { logger } from "../lib/logger.ts";
import { s3 } from "../lib/s3.ts";
import MusicModel from "../model/MusicModel.ts";
import { ApiError } from "../model/error.ts";

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

        const customCookies = Deno.env.get("COOKIES_FILE_PATH");

        const execOptions = [
            videoURL,
            '-f', 'ba',
            '-x',
            '--audio-format', 'opus',
            '--audio-quality', '0',
            '--embed-metadata',
            '--embed-thumbnail',
            '--force-overwrite',
            '-o', output
        ];

        if (customCookies) {
            execOptions.push('--cookies', customCookies);
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

async function downloadAndStore(audio: youtube_v3.Schema$PlaylistItem) {

    // Check if audio already exist
    const existedAudio = await MusicModel.findOne({ id: audio.id! }, { id: 1 });
    if (existedAudio) {
        logger.info(`Audio: ${audio.snippet?.title} already existed!`);
        return;
    }

    const videoTitle = audio.snippet?.title!;
    const channelTitle = audio.snippet?.channelTitle!;
    const channelId = audio.snippet?.channelId!;

    const audioId = audio.snippet?.resourceId?.videoId!;

    // Download the audio
    const downloadedPath = await downloadAudio(channelId, audioId, videoTitle);
    const audioFile = await Deno.readFile(downloadedPath);

    // Setup upload path
    const filename = `${videoTitle.replaceAll("/", "_").replaceAll(" ", "")}.opus`;
    const uploadedPath = `${channelTitle}/${filename}`;

    // Upload to S3 and cleanup
    await s3.write(uploadedPath, audioFile);
    await Deno.remove(downloadedPath);

    // Save the record to the database
    await MusicModel.findOneAndUpdate({
        id: audio.id!,
    }, {
        snippet: audio.snippet,
        streamUri: `https://music-library-r2.nvhub.my.id/${uploadedPath}`,
        contentDetails: audio.contentDetails
    }, {
        upsert: true
    });
}

export async function downloadAndStoreVideosByPlaylistId(auth: OAuth2Client, playlistId: string) {

    await ensureDir(`musics/${playlistId}`);

    let videoNextPageToken: string | undefined = undefined;

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
            const slicedAudio = playlistVideos.items!.slice(index, index + MAX_AUDIO_PER_LOOP);

            try {
                // Loop each video
                await Promise.all(slicedAudio.map(downloadAndStore));
            } catch (error) {
                console.error('Error downloading videos:', error);
                continue;
            }

        }
    } while (videoNextPageToken);

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

// New function to download and store a single YouTube video
export async function downloadAndStoreSingleVideo(auth: OAuth2Client, videoId: string): Promise<void> {
    // Fetch video details using YouTube API
    const { data: videoRes } = await service.playlistItems.list({
        auth,
        videoId,
        part: ["snippet", "contentDetails"],
    });

    if (!videoRes.items?.length) {
        throw new ApiError(404).setError("Video not found");
    }

    const video = videoRes.items[0];

    await downloadAndStore(video);
}

/**
 * Gets a paginated list of musics with optional text search
 * @param page The page number (starts from 1)
 * @param limit The number of items per page
 * @param searchKeyword Optional search term for title and channel title
 * @returns Music items and pagination metadata
 */
// Interface for the getMusics function parameters
export interface GetMusicsParams {
    page: number;
    limit: number;
    searchKeyword?: string;
    fields?: string; // Add fields parameter for selecting specific fields
}

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
            .skip(skip)
            .limit(limit)
            .lean(),
        MusicModel.countDocuments(query)
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

/**
 * Gets a single track by its ID
 * @param id The unique identifier of the track
 * @param fields Optional dot notation fields to include in the response
 * @returns The track data or throws a 404 error if not found
 */
export async function getTrackById(id: string, fields?: string) {
    const projection = parseFieldsToProjection(fields);

    const track = await MusicModel.findOne({ id }, projection).lean();

    if (!track) {
        throw new ApiError(404).setError(`Track with id ${id} not found`);
    }

    return track;
}