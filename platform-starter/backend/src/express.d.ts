import type { DeveloperContext } from "./types.js";

declare global {
  namespace Express {
    interface Request {
      developer?: DeveloperContext;
    }
  }
}

export {};
