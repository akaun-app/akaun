import { env } from "$env/dynamic/private";
import { db } from "../db/client.js";
import { oauthConfig } from "./config.js";
import { createOAuth } from "./service.js";

export const config = oauthConfig(env);
export const oauth = config ? createOAuth(db, config) : null;
