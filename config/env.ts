import { z } from 'zod';

const envSchema = z.object({
    ENV: z.enum(['development', 'production']).default('development'),
    PORT: z.string().default('4000').transform(Number),

    R2_ACCESS_KEY_ID: z.string(),
    R2_SECRET_ACCESS_KEY: z.string(),
    R2_ACCOUNT_ID: z.string(),

    DATABASE_URL: z.string(),

    TEST_DATABASE_URL: z.string().optional(),

    GOOGLE_API_KEY: z.string(),

    FFMPEG_LOCATION: z.string().optional(),

    COOKIES_FILE_PATH: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export default envSchema.parse(Deno.env.toObject());