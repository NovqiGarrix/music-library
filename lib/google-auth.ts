import { OAuth2Client } from "google-auth-library";
import env from "../config/env.ts";

export const googleAuth = new OAuth2Client({
    apiKey: env.GOOGLE_API_KEY
});