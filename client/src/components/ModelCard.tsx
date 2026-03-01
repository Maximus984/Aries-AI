import { useMemo } from "react";
import { speakText, stopTextSpeech } from "../speech";
import type { ModelResult, ModelLane } from "../types";
import { RichContent } from "./RichContent";

type ModelCardProps = {
  lane: ModelLane;
  result?: ModelResult;
  pending: boolean;
  hideFailureDetails?: boolean;
};

const laneLabel: Record<ModelLane, string> = {
  "gemini-pro": "Quality lane",
  "gemini-flash": "Speed lane"
};

export const ModelCard = ({ lane, result, pending, hideFailureDetails = false }: ModelCardProps) => {
  const laneName = result?.label ?? laneLabel[lane];

  const content = useMemo(() => {
    if (pending) {
      return (
        <div className="skeleton-block" aria-label={`${laneName} loading`}>
          <span className="skeleton-line" />
          <span className="skeleton-line short" />
          <span className="skeleton-line" />
        </div>
      );
    }

    if (!result) {
      return <p className="card-muted">Waiting for response.</p>;
    }

    if (!result.ok) {
      return (
        <p className={hideFailureDetails ? "card-muted" : "card-error"}>
          {hideFailureDetails ? "This lane could not respond right now." : result.error ?? "Model request failed."}
        </p>
      );
    }

    return <RichContent text={result.text} className="card-text" />;
  }, [pending, result, laneName, hideFailureDetails]);

  const handleCopy = async () => {
    if (!result?.ok || !result.text) {
      return;
    }

    if (!navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(result.text);
  };

  const handleRead = () => {
    if (!result?.ok || !result.text) {
      return;
    }
    void speakText(result.text);
  };

  return (
    <article className="model-card" data-lane={lane}>
      <header className="model-card-header">
        <div>
          <p className="model-badge">{laneName}</p>
          <p className="card-meta">{result?.latencyMs ? `${result.latencyMs} ms` : pending ? "Thinking..." : "Idle"}</p>
        </div>
        <button
          type="button"
          className="ghost-btn"
          onClick={handleCopy}
          disabled={!result?.ok || pending}
          aria-label={`Copy ${laneName} response`}
        >
          Copy
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={handleRead}
          disabled={!result?.ok || pending}
          aria-label={`Read ${laneName} response aloud`}
        >
          Read
        </button>
        <button type="button" className="ghost-btn" onClick={stopTextSpeech} aria-label={`Stop reading ${laneName} response`}>
          Stop
        </button>
      </header>
      <div className="model-card-body">{content}</div>
    </article>
  );
};
