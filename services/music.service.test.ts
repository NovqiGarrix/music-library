import '@std/dotenv/load';

import mongoose from "mongoose";
import env from "../config/env.ts";
import MusicModel from "../model/MusicModel.ts";


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