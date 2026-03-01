export type PlanTier = "free" | "pro" | "enterprise";

export type DeveloperContext = {
  userId: string;
  apiKeyId: string;
  planTier: PlanTier;
  rpmLimit: number;
  keyPrefix: string;
};
