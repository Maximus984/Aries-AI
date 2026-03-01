import type { ChatTurn } from "../types";
import { speakText, stopTextSpeech } from "../speech";
import { formatLocalTime } from "../utils";
import { ModelCard } from "./ModelCard";
import { RichContent } from "./RichContent";

type TurnRowProps = {
  turn: ChatTurn;
  pending: boolean;
  onRetry?: () => void;
  onDelete?: () => void;
  hideFailureDetails?: boolean;
};

export const TurnRow = ({ turn, pending, onRetry, onDelete, hideFailureDetails = false }: TurnRowProps) => {
  const hasFailure = (turn.pro && !turn.pro.ok) || (turn.flash && !turn.flash.ok);
  const proText = turn.pro?.ok ? turn.pro.text.trim() : "";
  const flashText = turn.flash?.ok ? turn.flash.text.trim() : "";
  const hasAnswer = proText.length > 0 || flashText.length > 0;

  const ariesResponse = (() => {
    if (!hasAnswer) {
      return "";
    }

    if (proText && flashText) {
      if (proText === flashText) {
        return proText;
      }

      return `${proText}\n\nRefinement:\n${flashText}`;
    }

    return proText || flashText;
  })();

  const averageLatencyMs = (() => {
    const valid = [turn.pro?.latencyMs, turn.flash?.latencyMs].filter(
      (value): value is number => typeof value === "number" && value > 0
    );
    if (valid.length === 0) {
      return null;
    }

    return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
  })();

  const handleCopyAriesResponse = async () => {
    if (!ariesResponse || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(ariesResponse);
  };

  const handleReadUserPrompt = () => {
    void speakText(turn.userText);
  };

  const handleReadAriesResponse = () => {
    if (!ariesResponse) {
      return;
    }
    void speakText(ariesResponse);
  };

  return (
    <section className="turn-row">
      <div className="user-message">
        <div className="message-head-row">
          <p className="message-label">You</p>
          <div className="message-actions">
            <button type="button" className="ghost-btn" onClick={handleReadUserPrompt} aria-label="Read your message aloud">
              Read
            </button>
            <button type="button" className="ghost-btn" onClick={stopTextSpeech} aria-label="Stop reading message aloud">
              Stop
            </button>
          </div>
        </div>
        <p className="message-body">{turn.userText}</p>
        <p className="message-time">{formatLocalTime(turn.createdAt)}</p>
      </div>

      <article className="aries-response">
        <header className="aries-response-header">
          <div>
            <p className="model-badge">Aries Response</p>
            <p className="card-meta">
              {averageLatencyMs ? `${averageLatencyMs} ms average` : pending ? "Thinking..." : "Idle"}
            </p>
          </div>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void handleCopyAriesResponse()}
            disabled={!ariesResponse}
            aria-label="Copy Aries response"
          >
            Copy
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={handleReadAriesResponse}
            disabled={!ariesResponse}
            aria-label="Read Aries response aloud"
          >
            Read
          </button>
          <button type="button" className="ghost-btn" onClick={stopTextSpeech} aria-label="Stop reading Aries response aloud">
            Stop
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={onDelete}
            disabled={pending || !onDelete}
            aria-label="Delete message"
          >
            Delete
          </button>
        </header>

        <div className="aries-response-body">
          {pending && !hasAnswer ? (
            <div className="skeleton-block" aria-label="Aries response loading">
              <span className="skeleton-line" />
              <span className="skeleton-line short" />
              <span className="skeleton-line" />
            </div>
          ) : null}

          {!pending && hasAnswer ? <RichContent text={ariesResponse} className="card-text" /> : null}

          {!pending && !hasAnswer ? (
            <p className={hideFailureDetails ? "card-muted" : "card-error"}>
              {hideFailureDetails
                ? "Aries couldn't complete this turn right now. Please try again."
                : turn.pro?.error || turn.flash?.error || "No response was returned for this turn."}
            </p>
          ) : null}
        </div>
      </article>

      <details className="lane-details">
        <summary>View lane details</summary>
        <div className="model-grid">
          <ModelCard
            lane="gemini-pro"
            result={turn.pro}
            pending={pending && !turn.pro}
            hideFailureDetails={hideFailureDetails}
          />
          <ModelCard
            lane="gemini-flash"
            result={turn.flash}
            pending={pending && !turn.flash}
            hideFailureDetails={hideFailureDetails}
          />
        </div>
      </details>

      {turn.blocked ? (
        <div className="guardrail-note">
          <strong>Safety block:</strong> this prompt was blocked and reported for admin/staff review.
          {!hideFailureDetails && turn.reportId ? ` Report ID: ${turn.reportId}` : ""}
        </div>
      ) : null}

      {hasFailure && onRetry ? (
        <div className="retry-row">
          <button type="button" className="ghost-btn" onClick={onRetry}>
            Retry turn
          </button>
        </div>
      ) : null}
    </section>
  );
};
