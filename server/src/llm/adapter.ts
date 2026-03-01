import type { DualChatRequest, ModelResult } from "../types.js";

export type DualModelResult = {
  pro: ModelResult;
  flash: ModelResult;
};

export interface DualModelAdapter {
  generateDual(request: DualChatRequest): Promise<DualModelResult>;
}
