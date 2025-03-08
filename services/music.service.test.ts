import '@std/dotenv/load';

import mongoose from "mongoose";
import env from "../config/env.ts";
import MusicModel from "../model/MusicModel.ts";
import { googleAuth } from "../lib/google-auth.ts";
import { downloadAndStoreVideosByPlaylistId } from "./music.service.ts";
import { assertEquals } from "@std/assert";

Deno.test("remove any duplicates", async (t) => {

    await mongoose.connect(env.DATABASE_URL);

    await t.step("Remove: ", async () => {

        const findDuplicates = await MusicModel.aggregate(
            [
                {
                    $group: {
                        _id: "$id",
                        count: { $sum: 1 },
                    },
                },
                {
                    $match: {
                        count: { $gt: 1 },
                    },
                },
            ],
        );

        if (!findDuplicates.length) {
            console.log("No duplicates found");
            return;
        }

        console.log("Duplicates found:");

        for await (const duplicate of findDuplicates) {
            const videoId = duplicate._id;
            const count = duplicate.count;

            console.log(`Video ID: ${videoId}, Count: ${count}`);

            // Find all documents with the same videoId
            const duplicates = await MusicModel.find({ id: videoId });

            // Keep the first document and delete the rest
            for (let i = 1; i < duplicates.length; i++) {
                await duplicates[i].deleteOne();
                console.log(`Removed duplicate with ID: ${duplicates[i].id}`);
            }
        }
        console.log("Duplicates removed");

    });

    for await (const connection of mongoose.connections) {
        await connection.close(true);
    }

});

Deno.test("Add createdAt and updatedAt", async () => {
    await mongoose.connect(env.DATABASE_URL);

    const musics = await MusicModel.find({});

    for await (const music of musics) {
        if (!music.createdAt) {
            music.createdAt = new Date();
        }
        if (!music.updatedAt) {
            music.updatedAt = new Date();
        }
        await music.save();
    }

    for await (const connection of mongoose.connections) {
        await connection.close(true);
    }

});

Deno.test("downloadAndStoreVideosByPlaylistId should not create duplicates", async (t) => {
    // Connect to the database
    await mongoose.connect(env.TEST_DATABASE_URL!);

    await MusicModel.deleteMany();

    const playlistId = "PLyq6g7XyWWBpgR-htsKvNco8mSQ6Caql5";

    try {
        // Run the first time to download videos and store them
        await t.step("First run: download and store videos", async () => {
            const initialResult = await downloadAndStoreVideosByPlaylistId(googleAuth, playlistId);
            console.log(`First run completed with ${initialResult?.length || 0} videos processed`);
        });

        // Count the number of records after first run
        const countAfterFirstRun = await MusicModel.countDocuments({});

        // Run the function a second time with the same playlist ID
        await t.step("Second run: should not create duplicates", async () => {
            await downloadAndStoreVideosByPlaylistId(googleAuth, playlistId);
        });

        // Count again after the second run
        const countAfterSecondRun = await MusicModel.countDocuments({});

        // Verify counts are the same, meaning no duplicates were created
        await t.step("Verify no duplicates were created", async () => {
            assertEquals(
                countAfterFirstRun,
                countAfterSecondRun,
                `Expected ${countAfterFirstRun} records, but found ${countAfterSecondRun} after second run.`
            );

            // Additional check: Ensure no duplicate IDs exist
            const duplicateCheck = await MusicModel.aggregate([
                { $group: { _id: "$id", count: { $sum: 1 } } },
                { $match: { count: { $gt: 1 } } }
            ]);

            assertEquals(
                duplicateCheck.length,
                0,
                `Found ${duplicateCheck.length} videos with duplicate entries.`
            );
        });
    } finally {
        // Clean up: Close database connections
        for await (const connection of mongoose.connections) {
            await connection.close(true);
        }
    }
});