import { Container, getContainer } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

export class PresentStudioContainer extends Container {
  defaultPort = 8000;
  sleepAfter = "30m";
  envVars = {
    DATABASE_URL: env.DATABASE_URL,
    JWT_SECRET: env.JWT_SECRET,
    PUBLIC_BASE_URL: env.PUBLIC_BASE_URL,
    CLOUDINARY_CLOUD_NAME: env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: env.CLOUDINARY_API_SECRET,
    CLOUDINARY_FOLDER: env.CLOUDINARY_FOLDER,
  };
}

export default {
  fetch(request: Request) {
    return getContainer(env.PRESENT_STUDIO).fetch(request);
  },
};
