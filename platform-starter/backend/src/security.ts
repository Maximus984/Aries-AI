import { createHash, randomBytes } from "node:crypto";

export const hashApiKey = (rawKey: string): string =>
  createHash("sha256").update(rawKey).digest("hex");

export const generateApiKey = (): { plaintext: string; prefix: string; hash: string } => {
  const plaintext = `aries_dev_${randomBytes(24).toString("hex")}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, 18),
    hash: hashApiKey(plaintext)
  };
};
