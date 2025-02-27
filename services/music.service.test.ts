import '@std/dotenv/load';

// import MusicModel from "../model/MusicModel.ts";
import { novo, ObjectId } from 'https://raw.githubusercontent.com/NovqiGarrix/novo/main/mod.ts';
import env from "../config/env.ts";
import { logger } from "../lib/logger.ts";

export interface Music {
    _id: ObjectId
    id: string
    snippet: Snippet
    streamUri: string
}

export interface Snippet {
    publishedAt: PublishedAt
    channelId: string
    title: string
    description: string
    thumbnails: Thumbnails
    channelTitle: string
    playlistId: string
    resourceId: ResourceId
    videoOwnerChannelTitle: string
    videoOwnerChannelId: string
    _id: Id9
}

export interface PublishedAt {
    $date: string
}

export interface Thumbnails {
    default: Default
    medium: Medium
    high: High
    standard: Standard
    maxres: Maxres
    _id: Id7
}

export interface Default {
    url: string
    width: number
    height: number
    _id: Id2
}

export interface Id2 {
    $oid: string
}

export interface Medium {
    url: string
    width: number
    height: number
    _id: Id3
}

export interface Id3 {
    $oid: string
}

export interface High {
    url: string
    width: number
    height: number
    _id: Id4
}

export interface Id4 {
    $oid: string
}

export interface Standard {
    url: string
    width: number
    height: number
    _id: Id5
}

export interface Id5 {
    $oid: string
}

export interface Maxres {
    url: string
    width: number
    height: number
    _id: Id6
}

export interface Id6 {
    $oid: string
}

export interface Id7 {
    $oid: string
}

export interface ResourceId {
    kind: string
    videoId: string
    _id: Id8
}

export interface Id8 {
    $oid: string
}

export interface Id9 {
    $oid: string
}

const MusicModel = novo.model<Music>('musics');

Deno.test("Update all data on DB to use Video schema instead", async () => {
    await novo.connect(env.DATABASE_URL);

    // List of PlaylistItem 
    const musics = await MusicModel.find();

    for await (const music of musics) {
        await MusicModel.updateOne({ _id: music._id }, {
            id: music.snippet.resourceId.videoId,
            snippet: music.snippet,
            streamUri: music.streamUri
        });
    }

    novo.disconnect();
    logger.info("Done");
});