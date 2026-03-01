import type { ReactNode } from "react";

type RichContentProps = {
  text: string;
  className?: string;
};

type YoutubePreview = {
  url: string;
  videoId: string;
};

const URL_PATTERN = /(https?:\/\/[^\s<>"'`)\]]+)/gi;

const isLikelyYoutubeHost = (host: string): boolean => {
  const normalized = host.toLowerCase();
  return (
    normalized === "youtube.com" ||
    normalized === "www.youtube.com" ||
    normalized === "m.youtube.com" ||
    normalized === "music.youtube.com" ||
    normalized === "youtu.be" ||
    normalized.endsWith(".youtube.com")
  );
};

const normalizeUrl = (raw: string): string | null => {
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
};

const extractYoutubeVideoId = (raw: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (!isLikelyYoutubeHost(parsed.hostname)) {
    return null;
  }

  if (parsed.hostname.toLowerCase() === "youtu.be") {
    const candidate = parsed.pathname.replace("/", "").trim();
    return /^[\w-]{11}$/.test(candidate) ? candidate : null;
  }

  const fromQuery = parsed.searchParams.get("v")?.trim();
  if (fromQuery && /^[\w-]{11}$/.test(fromQuery)) {
    return fromQuery;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && (segments[0] === "shorts" || segments[0] === "embed")) {
    const candidate = segments[1];
    return /^[\w-]{11}$/.test(candidate) ? candidate : null;
  }

  return null;
};

const lineToNodes = (line: string, lineIndex: number): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = 0;
  let match = URL_PATTERN.exec(line);

  while (match) {
    const full = match[0];
    const start = match.index;
    const end = start + full.length;

    if (start > cursor) {
      nodes.push(line.slice(cursor, start));
    }

    const normalized = normalizeUrl(full);
    if (normalized) {
      nodes.push(
        <a
          key={`line-${lineIndex}-url-${matchIndex}`}
          className="rich-link"
          href={normalized}
          target="_blank"
          rel="noreferrer noopener"
        >
          {normalized}
        </a>
      );
    } else {
      nodes.push(full);
    }

    cursor = end;
    matchIndex += 1;
    match = URL_PATTERN.exec(line);
  }

  URL_PATTERN.lastIndex = 0;
  if (cursor < line.length) {
    nodes.push(line.slice(cursor));
  }

  return nodes.length > 0 ? nodes : [line];
};

const getYoutubePreviews = (text: string): YoutubePreview[] => {
  const unique = new Map<string, YoutubePreview>();
  const matches = text.match(URL_PATTERN) ?? [];
  for (const raw of matches) {
    const normalized = normalizeUrl(raw);
    if (!normalized) {
      continue;
    }

    const videoId = extractYoutubeVideoId(normalized);
    if (!videoId) {
      continue;
    }

    if (!unique.has(videoId)) {
      unique.set(videoId, { url: normalized, videoId });
    }
  }
  return [...unique.values()];
};

export const RichContent = ({ text, className }: RichContentProps) => {
  const safeText = text.trim();
  if (!safeText) {
    return null;
  }

  const lines = safeText.split("\n");
  const youtubePreviews = getYoutubePreviews(safeText);

  return (
    <div className={`rich-content ${className ?? ""}`.trim()}>
      <div className="rich-lines">
        {lines.map((line, lineIndex) => (
          <p key={`line-${lineIndex}`} className="rich-line">
            {lineToNodes(line, lineIndex)}
          </p>
        ))}
      </div>

      {youtubePreviews.length > 0 ? (
        <div className="youtube-preview-grid">
          {youtubePreviews.map((item) => (
            <a
              key={item.videoId}
              className="youtube-preview-card"
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              <img
                loading="lazy"
                src={`https://img.youtube.com/vi/${item.videoId}/hqdefault.jpg`}
                alt="YouTube thumbnail preview"
              />
              <span>Open YouTube Video</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
};
