import { ensureDir } from '@std/fs';
import { OAuth2Client } from "google-auth-library";
import { google, youtube_v3 } from "googleapis";
import mongoose from "mongoose";
import YTDlpWrap from 'yt-dlp-wrap';
import { s3 } from "./lib/s3.ts";
import MusicModel from "./model/MusicModel.ts";

const service = google.youtube("v3");
const ytDlpWrap = new YTDlpWrap.default();

function downloadAudio(playlistId: string, videoId: string, videoTitle: string) {
  const videoURL = `https://www.youtube.com/watch?v=${videoId}`;
  return new Promise<string>((resolve) => {
    const output = `musics/${playlistId}/${videoTitle}.opus`;

    ytDlpWrap.exec([
      videoURL,
      '-f', 'ba',
      '-x',
      '--audio-format', 'opus',
      '--audio-quality', '0',
      '--embed-metadata',
      '--embed-thumbnail',
      '--force-overwrite',
      '-o', output
    ]).on('progress', (progress) => {
      console.log(`-- ${videoTitle}: ${progress.percent}%`);
    }).on('close', (code) => {
      console.log(`-- ${videoTitle}: Finished with code ${code}`);
      resolve(output);
    })
  })
}

async function uploadPlaylistVideos(auth: OAuth2Client, playlistId: string) {

  await ensureDir(`musics/${playlistId}`);

  let first = true;
  let videoNextPageToken: string | undefined = undefined;

  while (first || videoNextPageToken) {
    const { data: playlistVideos }: { data: youtube_v3.Schema$PlaylistItemListResponse } = await service.playlistItems.list({
      auth,
      playlistId,
      part: ["snippet"],
      maxResults: 50,
      pageToken: videoNextPageToken,
      fields: "nextPageToken, items(id, snippet)",
    });

    first = false;
    videoNextPageToken = playlistVideos.nextPageToken ?? undefined;

    // Loop each video
    for await (const audio of playlistVideos.items!) {
      try {

        // Check if audio already exists
        const music = await MusicModel.findOne({ id: audio.id! }, { id: 1 });
        if (music) {
          console.log(`${audio.snippet?.title} already exists`);
          continue;
        }

        const channelTitle = audio.snippet?.channelTitle!;
        const filename = `${audio.snippet?.title}.opus`;
        const uploadedPath = `${channelTitle}/${filename}`;

        const downloadedPath = await downloadAudio(playlistId, audio.snippet?.resourceId?.videoId!, audio.snippet?.title!);
        const audioFile = await Deno.readFile(downloadedPath);

        console.log(`Uploading ${uploadedPath} --`);

        await s3.write(uploadedPath, audioFile);

        console.log(`-- ${uploadedPath} uploaded`);

        await Deno.remove(downloadedPath);

        console.log(`-- ${uploadedPath} deleted`);

        console.log(`${uploadedPath} Saving to DB: --`);

        await MusicModel.create({
          ...audio,
          streamUri: `https://music-library-r2.nvhub.my.id/${uploadedPath}`,
        });

        console.log(`-- ${uploadedPath} Saved to DB:`);
      } catch (error) {
        console.log(error);
      }
    }
  }

}

/**
 * Lists the names and IDs of up to 10 files.
 */
async function getPlaylists(auth: OAuth2Client): Promise<void> {

  try {

    let first = true;
    let nextPageToken: string | undefined = undefined;

    while (first || nextPageToken) {
      const { data: playlists }: { data: youtube_v3.Schema$PlaylistListResponse } = await service.playlists.list({
        auth,
        channelId: "UCv0tIDoaBZCTXQvVO4zosng",
        fields: "*",
        part: ["snippet"],
        pageToken: nextPageToken
      });

      nextPageToken = playlists.nextPageToken ?? undefined;
      first = false;

      // Loop each playlist
      for await (const playlist of playlists.items!) {
        // Download and upload videos from playlist
        await uploadPlaylistVideos(auth, playlist.id!);
      }
    }

  } catch (err) {
    console.error("The API returned an error:", err);
  }
}

// Main execution
await mongoose.connect(Deno.env.get("DATABASE_URL")!);

const auth = new OAuth2Client({
  apiKey: Deno.env.get("DENO_API_KEY")
});

await getPlaylists(auth);