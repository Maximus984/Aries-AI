import type { RefObject } from "react";
import { AriesLogo } from "./AriesLogo";
import type { LiveIntroState, LiveSpeakerState, LiveVoiceOption } from "../types";

type LiveTheaterProps = {
  theaterRef: RefObject<HTMLElement>;
  statusLabel: string;
  micStatusLabel: string;
  speakerState: LiveSpeakerState;
  introState: LiveIntroState;
  voiceEnabled: boolean;
  voiceOptions: LiveVoiceOption[];
  selectedVoiceId: string;
  voiceLoading: boolean;
  isListening: boolean;
  isProcessing: boolean;
  micMode: "toggle" | "push";
  autoListenEnabled: boolean;
  pushToTalkActive: boolean;
  fullscreenEnabled: boolean;
  fullscreenActive: boolean;
  liveControlsEnabled: boolean;
  showVoiceGate: boolean;
  canStartSession: boolean;
  canInterrupt: boolean;
  showSafetyAgreement: boolean;
  safetyAgreementChecked: boolean;
  onSafetyAgreementCheckedChange: (checked: boolean) => void;
  onSafetyAgreementContinue: () => void;
  onToggleAutoListen: (enabled: boolean) => void;
  onMicModeChange: (mode: "toggle" | "push") => void;
  onPushToTalkStart: () => void;
  onPushToTalkEnd: () => void;
  onInterrupt: () => void;
  onToggleVoice: (enabled: boolean) => void;
  onVoiceChange: (voiceOptionId: string) => void;
  onPreviewVoice: () => void;
  onStartSession: () => void;
  onToggleFullscreen: () => void;
  onExit: () => void;
  onIntroDone: () => void;
  onIntroError: () => void;
};

export const LiveTheater = ({
  theaterRef,
  statusLabel,
  micStatusLabel,
  speakerState,
  introState,
  voiceEnabled,
  voiceOptions,
  selectedVoiceId,
  voiceLoading,
  isListening,
  isProcessing,
  micMode,
  autoListenEnabled,
  pushToTalkActive,
  fullscreenEnabled,
  fullscreenActive,
  liveControlsEnabled,
  showVoiceGate,
  canStartSession,
  canInterrupt,
  showSafetyAgreement,
  safetyAgreementChecked,
  onSafetyAgreementCheckedChange,
  onSafetyAgreementContinue,
  onToggleAutoListen,
  onMicModeChange,
  onPushToTalkStart,
  onPushToTalkEnd,
  onInterrupt,
  onToggleVoice,
  onVoiceChange,
  onPreviewVoice,
  onStartSession,
  onToggleFullscreen,
  onExit,
  onIntroDone,
  onIntroError
}: LiveTheaterProps) => {
  const showIntro = !showVoiceGate && (introState === "playing" || introState === "error");
  const activeVoice = voiceOptions.find((voice) => voice.id === selectedVoiceId);

  return (
    <section ref={theaterRef} className={`live-theater live-speaker-${speakerState}`} aria-label="Aries live theater">
      <div className="live-theater-chrome">
        <div>
          <div className="aries-identity">
            <AriesLogo className="brand-logo" />
            <div>
              <p className="eyebrow">Aries</p>
              <h2>Aries Live</h2>
            </div>
          </div>
          <p className="card-muted">Voice-first immersive mode.</p>
        </div>
        <div className="live-theater-actions">
          <button type="button" className="ghost-btn" onClick={() => onToggleVoice(!voiceEnabled)}>
            {voiceEnabled ? "Mute Voice" : "Unmute Voice"}
          </button>
          <button type="button" className="ghost-btn" onClick={onToggleFullscreen}>
            {fullscreenActive ? "Exit Fullscreen" : fullscreenEnabled ? "Fullscreen: On" : "Fullscreen: Off"}
          </button>
          <button type="button" className="ghost-btn" onClick={onExit}>
            Exit Aries Live
          </button>
        </div>
      </div>

      <section className={`live-stage live-${speakerState}`} aria-label={`Live status: ${statusLabel}`}>
        <div className="live-orb">
          <span className="live-ring ring-a" />
          <span className="live-ring ring-b" />
          <span className="live-ring ring-c" />
          <div className="live-core">
            <p>Aries Live</p>
            <strong>{statusLabel}</strong>
          </div>
        </div>
        <div className="live-wave" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="live-control-dock">
        <div className="live-status-row">
          <span
            className={`status ${
              isListening
                ? "live-listening"
                : isProcessing
                  ? "live-processing"
                  : speakerState === "assistant-speaking"
                    ? "live-speaking"
                    : "live-idle"
            }`}
          >
            {micStatusLabel}
          </span>
          {showVoiceGate ? <p className="card-muted">Choose a voice to start this Aries Live session.</p> : null}
          {!showVoiceGate && !liveControlsEnabled ? <p className="card-muted">Complete safety agreement to enable controls.</p> : null}
        </div>

        <div className="live-voice-row">
          <label className="message-label" htmlFor="aries-live-voice-select-dock">
            Voice
          </label>
          <div className="live-voice-controls">
            <select
              id="aries-live-voice-select-dock"
              className="live-voice-select"
              value={selectedVoiceId}
              onChange={(event) => onVoiceChange(event.target.value)}
              disabled={voiceLoading || voiceOptions.length === 0}
            >
              {voiceOptions.length === 0 ? <option value="">No voices available</option> : null}
              {voiceOptions.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label} {voice.provider === "elevenlabs" ? "· Premium" : "· Browser"}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ghost-btn"
              onClick={onPreviewVoice}
              disabled={!voiceEnabled || voiceLoading || voiceOptions.length === 0 || !selectedVoiceId}
            >
              Preview Voice
            </button>
          </div>
          {activeVoice ? (
            <p className="card-muted">
              {activeVoice.provider === "elevenlabs" ? "Premium voice" : "Browser voice"}:{" "}
              {activeVoice.description ?? "Ready"}
            </p>
          ) : null}
        </div>

        <div className="live-mic-mode">
          <button
            type="button"
            className={`ghost-btn ${micMode === "toggle" ? "mode-active" : ""}`}
            onClick={() => onMicModeChange("toggle")}
            disabled={!liveControlsEnabled}
          >
            Tap Mode
          </button>
          <button
            type="button"
            className={`ghost-btn ${micMode === "push" ? "mode-active" : ""}`}
            onClick={() => onMicModeChange("push")}
            disabled={!liveControlsEnabled}
          >
            Push-to-Talk
          </button>
        </div>

        <div className="live-action-row">
          <button
            type="button"
            className="ghost-btn"
            onClick={onInterrupt}
            disabled={!canInterrupt && !isListening}
          >
            Interrupt
          </button>
          {micMode === "toggle" ? (
            <>
              <p className="live-auto-note">Auto-listen is on. Aries listens again after each reply.</p>
              <button
                type="button"
                className={autoListenEnabled ? "ghost-btn" : "primary-btn"}
                onClick={() => onToggleAutoListen(!autoListenEnabled)}
                disabled={isProcessing || !liveControlsEnabled}
              >
                {autoListenEnabled ? "Pause Auto-Listen" : "Resume Auto-Listen"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`primary-btn push-talk-btn ${pushToTalkActive ? "active" : ""}`}
              onPointerDown={onPushToTalkStart}
              onPointerUp={onPushToTalkEnd}
              onPointerCancel={onPushToTalkEnd}
              onPointerLeave={onPushToTalkEnd}
              onKeyDown={(event) => {
                if ((event.key === " " || event.key === "Enter") && !pushToTalkActive) {
                  event.preventDefault();
                  onPushToTalkStart();
                }
              }}
              onKeyUp={(event) => {
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  onPushToTalkEnd();
                }
              }}
              onBlur={onPushToTalkEnd}
              disabled={isProcessing || !liveControlsEnabled}
            >
              {pushToTalkActive ? "Listening..." : "Hold to Talk"}
            </button>
          )}
        </div>
      </section>

      {showIntro ? (
        <div className="live-intro-overlay" role="dialog" aria-label="Aries live intro">
          {introState === "error" ? (
            <div className="live-intro-fallback">
              <p className="message-label">Aries Live</p>
              <p className="card-text">Intro video could not be played. Continue to Aries Live.</p>
              <button type="button" className="primary-btn" onClick={onIntroDone}>
                Continue
              </button>
            </div>
          ) : (
            <>
              <video
                className="live-intro-video"
                src="/media/aries-live-startup.mp4"
                autoPlay
                muted
                playsInline
                onEnded={onIntroDone}
                onError={onIntroError}
              />
              <button type="button" className="ghost-btn live-intro-skip" onClick={onIntroDone}>
                Skip Intro
              </button>
            </>
          )}
        </div>
      ) : null}

      {showVoiceGate ? (
        <div className="live-voice-gate-overlay" role="dialog" aria-label="Choose Aries Live voice">
          <article className="live-voice-gate-card">
            <h3>Choose Your Aries Voice</h3>
            <p>Select a voice before starting this Aries Live session.</p>
            <label className="message-label" htmlFor="aries-live-voice-select-gate">
              Voice Profile
            </label>
            <select
              id="aries-live-voice-select-gate"
              className="live-voice-select"
              value={selectedVoiceId}
              onChange={(event) => onVoiceChange(event.target.value)}
              disabled={voiceLoading || voiceOptions.length === 0}
            >
              <option value="">{voiceLoading ? "Loading voices..." : "Select a voice profile"}</option>
              {voiceOptions.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label} {voice.provider === "elevenlabs" ? "· Premium" : "· Browser"}
                </option>
              ))}
            </select>
            {voiceOptions.length === 0 && !voiceLoading ? (
              <p className="card-muted">No voices are available right now. Reload and try again.</p>
            ) : null}
            {activeVoice ? (
              <p className="card-muted">
                Selected: {activeVoice.label} ({activeVoice.provider === "elevenlabs" ? "Premium" : "Browser"})
              </p>
            ) : null}
            <div className="live-voice-gate-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={onPreviewVoice}
                disabled={!voiceEnabled || !selectedVoiceId || voiceLoading}
              >
                Preview Voice
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={onStartSession}
                disabled={!canStartSession || voiceLoading}
              >
                Start Aries Live
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {showSafetyAgreement ? (
        <div className="live-safety-overlay" role="dialog" aria-label="Aries Live safety agreement">
          <article className="live-safety-card">
            <h3>⚠️ Aries Live: Safety Agreement</h3>
            <p>
              Before interacting with Aries, you must agree to the following safety terms designed to protect all users
              and comply with legal requirements:
            </p>
            <ol>
              <li>
                Zero Tolerance Policy
                <p>
                  Aries strictly prohibits any discussion related to promoting suicide, self-harm, or violence against
                  others, and the production, acquisition, or distribution of illegal substances.
                </p>
              </li>
              <li>
                Educational Exception
                <p>
                  These topics are allowed only within a strict, verifiable academic or educational context (for
                  example, historical research or literary analysis).
                </p>
              </li>
              <li>
                Reporting Obligation
                <p>
                  Aries monitors interactions for safety. Any genuine threats of self-harm, harm to others, or
                  dangerous illegal activity outside educational context are reported to admin/staff for escalation and
                  legal response.
                </p>
              </li>
            </ol>
            <label className="live-safety-check">
              <input
                type="checkbox"
                checked={safetyAgreementChecked}
                onChange={(event) => onSafetyAgreementCheckedChange(event.target.checked)}
              />
              I have read, understood, and agree to these terms.
            </label>
            <button
              type="button"
              className="primary-btn"
              onClick={onSafetyAgreementContinue}
              disabled={!safetyAgreementChecked}
            >
              Continue to Aries Live
            </button>
          </article>
        </div>
      ) : null}
    </section>
  );
};
