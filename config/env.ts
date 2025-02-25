import { z } from 'zod';

const envSchema = z.object({
    ENV: z.enum(['development', 'production']).default('development'),
    BASE_URL: z.string().default('http://localhost:4000'),

    R2_ACCESS_KEY_ID: z.string(),
    R2_SECRET_ACCESS_KEY: z.string(),
    R2_ACCOUNT_ID: z.string(),

    DATABASE_URL: z.string(),

    GOOGLE_API_KEY: z.string(),
});

export type Env = z.infer<typeof envSchema>;

export default envSchema.parse(Deno.env.toObject());