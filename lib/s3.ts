import { S3Client } from '@hk/s3';
import env from "../config/env.ts";

export const s3 = new S3Client({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: "music-library",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    region: "auto"
});