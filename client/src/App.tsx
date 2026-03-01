import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { FormEvent, KeyboardEventHandler } from "react";
import {
  checkHealth,
  createApiKey,
  createUserAsAdmin,
  executeFounderCommand,
  fetchAccountAudit,
  fetchApiKeys,
  fetchBannedIps,
  fetchGuidelines,
  fetchLiveVoices,
  fetchMe,
  fetchPermissions,
  fetchReports,
  fetchTerms,
  fetchUsers,
  generateImage,
  revokeApiKey,
  sendDualChat,
  submitFeedbackReport,
  signIn,
  signOut,
  signUp,
  synthesizeLiveVoice,
  updateReportStatus
} from "./api";
import { LiveTheater } from "./components/LiveTheater";
import { AriesLogo } from "./components/AriesLogo";
import { RichContent } from "./components/RichContent";
import { TurnRow } from "./components/TurnRow";
import { listBrowserSpeechVoices, speakText, stopTextSpeech } from "./speech";
import {
  clearAuth,
  loadActiveSessionId,
  loadAuth,
  loadLiveVoiceSelection,
  loadLiveVisualFullscreenPreference,
  loadStudioImages,
  loadSessions,
  saveActiveSessionId,
  saveAuth,
  saveLiveVoiceSelection,
  saveLiveVisualFullscreenPreference,
  saveSessions,
  saveStudioImages
} from "./storage";
import type {
  AccountAuditRecord,
  AutoScrollContext,
  ApiKeyMetadata,
  AuthUser,
  BannedIpRecord,
  ChatSession,
  ChatTurn,
  DualChatResponse,
  ImageGenerationResponse,
  GuidelinesResponse,
  HistoryMessage,
  LiveIntroState,
  LiveMicErrorCode,
  LiveVoiceOption,
  LiveSpeakerState,
  ModelLane,
  ModelResult,
  PermissionMatrix,
  SafetyReport,
  StudioImageItem,
  TermsResponse,
  UserRole
} from "./types";
import { nowIso, shortId, trimPreview } from "./utils";
import "./styles.css";

type AppState = {
  sessions: ChatSession[];
  activeSessionId: string;
  input: string;
  isSending: boolean;
  pendingTurnId?: string;
  apiOnline: boolean;
  globalError?: string;
};

type AppAction =
  | { type: "setInput"; value: string }
  | { type: "hydrateSessions"; sessions: ChatSession[]; activeSessionId: string }
  | { type: "setActiveSession"; sessionId: string }
  | { type: "createSession" }
  | { type: "deleteSession"; sessionId: string; index: number }
  | { type: "restoreSession"; session: ChatSession; index: number }
  | { type: "clearSessions" }
  | { type: "deleteTurn"; sessionId: string; turnId: string }
  | { type: "restoreTurn"; sessionId: string; turn: ChatTurn; index: number }
  | { type: "sendStart"; turn: ChatTurn }
  | { type: "sendSuccess"; turnId: string; response: DualChatResponse }
  | { type: "sendFailure"; turnId: string; error: string }
  | { type: "setApiOnline"; online: boolean }
  | { type: "clearError" };

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const USER_SAFE_FAILURE_MESSAGE = "Aries couldn't complete that request right now. Please try again.";
const LIVE_WELCOME_MESSAGE = `Hey there! I'm Aries, your adaptive AI collaborator. Think of me as a peer you can brainstorm with, interrupt, or dive deep with—all in real-time. Whether you need to parse some complex data, organize a project, or just run through ideas, I’m ready to chat.

What’s on your mind today?

Please take a look at the Terms of Agreement before we continue.`;
const LIVE_AGREEMENT_ACCEPTED_MESSAGE = "OK let's explore what's on your mind";
const CODE_LAB_TERMS = [
  "Generated code is provided for educational and development assistance only.",
  "You are responsible for reviewing security, licensing, and legal compliance before production use.",
  "Do not use generated code to create malware, abuse systems, or violate laws.",
  "Always run tests and perform code review before deployment."
];
const CODE_LANGUAGES = [
  "TypeScript",
  "JavaScript",
  "Python",
  "Go",
  "Java",
  "C++",
  "Rust",
  "HTML/CSS"
] as const;

const LIVE_MIC_ERROR_MESSAGES: Record<LiveMicErrorCode, string> = {
  "not-allowed": "Microphone permission was blocked. Allow microphone access in your browser and try again.",
  "not-found": "No microphone was detected. Connect a microphone and try again.",
  "insecure-context":
    "Microphone requires HTTPS or localhost. Open Aries at http://localhost:5173 or use HTTPS. LAN HTTP addresses (for example 192.168.x.x) are blocked by browsers.",
  unsupported: "Speech recognition is not supported in this browser. Use Chrome or Edge.",
  "start-failed": "Could not start live listening. Try reloading the page and allowing microphone access."
};

const micErrorCodeFromRecognitionError = (error: string): LiveMicErrorCode => {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "not-allowed";
    case "audio-capture":
      return "not-found";
    default:
      return "start-failed";
  }
};

const BROWSER_VOICE_PREFIX = "browser:";

const toBrowserVoiceId = (name: string, lang: string) =>
  `${BROWSER_VOICE_PREFIX}${encodeURIComponent(name)}::${encodeURIComponent(lang)}`;

const mapBrowserVoiceOptions = (): LiveVoiceOption[] =>
  listBrowserSpeechVoices()
    .filter((voice) => voice.lang.toLowerCase().startsWith("en"))
    .map((voice) => ({
      id: toBrowserVoiceId(voice.name, voice.lang),
      provider: "browser",
      label: `${voice.name}${voice.default ? " (Default)" : ""}`,
      browserVoiceName: voice.name,
      lang: voice.lang,
      description: `${voice.localService ? "Local" : "Online"} browser voice`
    }));

const createSession = (): ChatSession => {
  const stamp = nowIso();
  return {
    sessionId: shortId(),
    title: "New chat",
    createdAt: stamp,
    updatedAt: stamp,
    turns: []
  };
};

const toErrorResult = (model: ModelLane, message: string): ModelResult => ({
  model,
  text: "",
  latencyMs: 0,
  ok: false,
  error: message
});

const updateSession = (state: AppState, updater: (session: ChatSession) => ChatSession): ChatSession[] =>
  state.sessions.map((session) =>
    session.sessionId === state.activeSessionId ? updater(session) : session
  );

const reducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case "setInput":
      return { ...state, input: action.value };
    case "hydrateSessions":
      return {
        ...state,
        sessions: action.sessions,
        activeSessionId: action.activeSessionId,
        input: "",
        pendingTurnId: undefined,
        isSending: false,
        globalError: undefined
      };
    case "setActiveSession":
      return { ...state, activeSessionId: action.sessionId, globalError: undefined };
    case "createSession": {
      const session = createSession();
      return {
        ...state,
        sessions: [session, ...state.sessions],
        activeSessionId: session.sessionId,
        input: "",
        globalError: undefined
      };
    }
    case "deleteSession": {
      const remaining = state.sessions.filter((session) => session.sessionId !== action.sessionId);
      if (remaining.length === 0) {
        const fallback = createSession();
        return {
          ...state,
          sessions: [fallback],
          activeSessionId: fallback.sessionId,
          input: "",
          globalError: undefined
        };
      }

      if (state.activeSessionId !== action.sessionId) {
        return {
          ...state,
          sessions: remaining,
          globalError: undefined
        };
      }

      const fallbackIndex = Math.min(action.index, remaining.length - 1);
      return {
        ...state,
        sessions: remaining,
        activeSessionId: remaining[Math.max(0, fallbackIndex)].sessionId,
        input: "",
        globalError: undefined
      };
    }
    case "restoreSession": {
      const next = [...state.sessions];
      next.splice(Math.min(action.index, next.length), 0, action.session);
      return {
        ...state,
        sessions: next,
        activeSessionId: action.session.sessionId,
        globalError: undefined
      };
    }
    case "clearSessions": {
      const session = createSession();
      return {
        ...state,
        sessions: [session],
        activeSessionId: session.sessionId,
        input: "",
        globalError: undefined
      };
    }
    case "deleteTurn":
      return {
        ...state,
        sessions: state.sessions.map((session) => {
          if (session.sessionId !== action.sessionId) {
            return session;
          }

          const nextTurns = session.turns.filter((turn) => turn.id !== action.turnId);
          const nextTitle = nextTurns.length === 0 ? "New chat" : trimPreview(nextTurns[0].userText, 44);
          return {
            ...session,
            turns: nextTurns,
            title: nextTitle,
            updatedAt: nowIso()
          };
        }),
        globalError: undefined
      };
    case "restoreTurn":
      return {
        ...state,
        sessions: state.sessions.map((session) => {
          if (session.sessionId !== action.sessionId) {
            return session;
          }

          const nextTurns = [...session.turns];
          nextTurns.splice(Math.min(action.index, nextTurns.length), 0, action.turn);
          return {
            ...session,
            turns: nextTurns,
            title: trimPreview(nextTurns[0]?.userText ?? session.title, 44),
            updatedAt: nowIso()
          };
        }),
        globalError: undefined
      };
    case "sendStart": {
      return {
        ...state,
        input: "",
        isSending: true,
        pendingTurnId: action.turn.id,
        globalError: undefined,
        sessions: updateSession(state, (session) => {
          const firstTurn = session.turns.length === 0;
          return {
            ...session,
            turns: [...session.turns, action.turn],
            title: firstTurn ? trimPreview(action.turn.userText, 44) : session.title,
            updatedAt: nowIso()
          };
        })
      };
    }
    case "sendSuccess":
      return {
        ...state,
        isSending: false,
        pendingTurnId: undefined,
        sessions: updateSession(state, (session) => ({
          ...session,
          turns: session.turns.map((turn) => {
            if (turn.id !== action.turnId) {
              return turn;
            }
            return {
              ...turn,
              pro: action.response.pro,
              flash: action.response.flash,
              blocked: action.response.blocked,
              reportId: action.response.reportId
            };
          }),
          updatedAt: nowIso()
        }))
      };
    case "sendFailure":
      return {
        ...state,
        isSending: false,
        pendingTurnId: undefined,
        globalError: action.error,
        sessions: updateSession(state, (session) => ({
          ...session,
          turns: session.turns.map((turn) => {
            if (turn.id !== action.turnId) {
              return turn;
            }
            return {
              ...turn,
              pro: turn.pro ?? toErrorResult("gemini-pro", action.error),
              flash: turn.flash ?? toErrorResult("gemini-flash", action.error)
            };
          }),
          updatedAt: nowIso()
        }))
      };
    case "setApiOnline":
      return { ...state, apiOnline: action.online };
    case "clearError":
      return { ...state, globalError: undefined };
    default:
      return state;
  }
};

const buildHistory = (session: ChatSession): HistoryMessage[] => {
  const history: HistoryMessage[] = [];

  for (const turn of session.turns) {
    history.push({
      role: "user",
      content: turn.userText
    });

    if (turn.pro?.ok && turn.pro.text) {
      history.push({
        role: "assistant",
        content: turn.pro.text,
        model: "gemini-pro"
      });
    }

    if (turn.flash?.ok && turn.flash.text) {
      history.push({
        role: "assistant",
        content: turn.flash.text,
        model: "gemini-flash"
      });
    }
  }

  return history;
};

type PanelMode = "chat" | "studio" | "code" | "live" | "admin" | "terms" | "guidelines";

type CodeIdeaItem = {
  id: string;
  prompt: string;
  language: string;
  framework: string;
  responseText: string;
  createdAt: string;
  latencyMs?: number;
  blocked?: boolean;
  reportId?: string;
};

function App() {
  const fallbackSession = useMemo(createSession, []);
  const [state, dispatch] = useReducer(reducer, {
    sessions: [fallbackSession],
    activeSessionId: fallbackSession.sessionId,
    input: "",
    isSending: false,
    apiOnline: false
  });

  const [auth, setAuth] = useState(loadAuth());
  const [permissions, setPermissions] = useState<PermissionMatrix | null>(null);

  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [panel, setPanel] = useState<PanelMode>("chat");
  const [terms, setTerms] = useState<TermsResponse | null>(null);
  const [guidelines, setGuidelines] = useState<GuidelinesResponse | null>(null);
  const [legalBusy, setLegalBusy] = useState(false);
  const [legalError, setLegalError] = useState<string | null>(null);

  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyMetadata[]>([]);
  const [accountAudit, setAccountAudit] = useState<AccountAuditRecord[]>([]);
  const [bannedIps, setBannedIps] = useState<BannedIpRecord[]>([]);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<Exclude<UserRole, "founder">>("user");

  const [apiKeyLabel, setApiKeyLabel] = useState("External Integration Key");
  const [apiKeyOwnerEmail, setApiKeyOwnerEmail] = useState("");
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);

  const [terminalCommand, setTerminalCommand] = useState("pwd");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalBusy, setTerminalBusy] = useState(false);

  const [studioPrompt, setStudioPrompt] = useState("");
  const [studioCount, setStudioCount] = useState(1);
  const [studioBusy, setStudioBusy] = useState(false);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [studioItems, setStudioItems] = useState<StudioImageItem[]>(loadStudioImages());
  const [codePrompt, setCodePrompt] = useState("");
  const [codeLanguage, setCodeLanguage] = useState<(typeof CODE_LANGUAGES)[number]>("TypeScript");
  const [codeFramework, setCodeFramework] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeItems, setCodeItems] = useState<CodeIdeaItem[]>([]);

  const [liveDraft, setLiveDraft] = useState("");
  const [liveInterim, setLiveInterim] = useState("");
  const [liveStatus, setLiveStatus] = useState<"idle" | "listening" | "processing" | "speaking">("idle");
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveVoiceEnabled, setLiveVoiceEnabled] = useState(true);
  const [serverLiveVoiceOptions, setServerLiveVoiceOptions] = useState<LiveVoiceOption[]>([]);
  const [browserLiveVoiceOptions, setBrowserLiveVoiceOptions] = useState<LiveVoiceOption[]>(() => mapBrowserVoiceOptions());
  const [liveVoiceLoading, setLiveVoiceLoading] = useState(false);
  const [selectedLiveVoiceId, setSelectedLiveVoiceId] = useState<string>("");
  const [liveTranscript, setLiveTranscript] = useState<
    Array<{ id: string; role: "user" | "assistant"; text: string; timestamp: string }>
  >([]);
  const [liveVisualFullscreen, setLiveVisualFullscreen] = useState(() => loadLiveVisualFullscreenPreference());
  const [liveVisualIsFullscreen, setLiveVisualIsFullscreen] = useState(false);
  const [liveMicMode, setLiveMicMode] = useState<"toggle" | "push">("toggle");
  const [liveAutoListenEnabled, setLiveAutoListenEnabled] = useState(true);
  const [pushToTalkActive, setPushToTalkActive] = useState(false);
  const [liveTheaterActive, setLiveTheaterActive] = useState(false);
  const [liveVoiceConfirmed, setLiveVoiceConfirmed] = useState(false);
  const [liveIntroState, setLiveIntroState] = useState<LiveIntroState>("idle");
  const [liveWelcomeComplete, setLiveWelcomeComplete] = useState(false);
  const [liveSafetyAgreementChecked, setLiveSafetyAgreementChecked] = useState(false);
  const [liveSafetyAgreementAccepted, setLiveSafetyAgreementAccepted] = useState(false);
  const [liveSpeakerState, setLiveSpeakerState] = useState<LiveSpeakerState>("idle");
  const [undoNotice, setUndoNotice] = useState<{ id: string; label: string; undo: () => void } | null>(null);
  const [adminIncidentCount, setAdminIncidentCount] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recognitionStopRequestedRef = useRef(false);
  const liveListenModeRef = useRef<"toggle" | "push">("toggle");
  const pushToTalkActiveRef = useRef(false);
  const liveAudioRef = useRef<HTMLAudioElement | null>(null);
  const liveWelcomeStartedRef = useRef(false);
  const liveTurnSerialRef = useRef(0);
  const knownReportIdsRef = useRef<Set<string>>(new Set());
  const seededReportIdsRef = useRef(false);
  const finalVoiceInputRef = useRef("");
  const hydrateUserRef = useRef<string | null>(null);
  const undoTimeoutRef = useRef<number | null>(null);
  const chatThreadRef = useRef<HTMLElement | null>(null);
  const liveLogRef = useRef<HTMLElement | null>(null);
  const liveTheaterRef = useRef<HTMLElement | null>(null);
  const liveStatusLabel =
    liveStatus === "idle"
      ? "Ready"
      : liveStatus === "listening"
        ? "Listening"
        : liveStatus === "processing"
          ? "Thinking"
          : "Speaking";
  const liveVoiceOptions = useMemo(
    () => [...serverLiveVoiceOptions, ...browserLiveVoiceOptions],
    [serverLiveVoiceOptions, browserLiveVoiceOptions]
  );
  const selectedLiveVoice = useMemo(
    () => liveVoiceOptions.find((voice) => voice.id === selectedLiveVoiceId) ?? null,
    [liveVoiceOptions, selectedLiveVoiceId]
  );
  const hasSelectedLiveVoice = Boolean(
    selectedLiveVoiceId && liveVoiceOptions.some((voice) => voice.id === selectedLiveVoiceId)
  );
  const showLiveVoiceGate = !liveVoiceConfirmed || !hasSelectedLiveVoice;

  const activeSession = state.sessions.find((session) => session.sessionId === state.activeSessionId) ?? state.sessions[0];
  const currentUser = auth?.user ?? null;
  const showDiagnosticDetails = currentUser ? currentUser.role !== "user" : false;
  const liveControlsEnabled =
    !showLiveVoiceGate && liveSafetyAgreementAccepted && liveWelcomeComplete && liveIntroState === "done";
  const showLiveSafetyAgreement =
    !showLiveVoiceGate && liveIntroState === "done" && liveWelcomeComplete && !liveSafetyAgreementAccepted;

  const hasPerm = (permission: string) => Boolean(permissions?.allowed.includes(permission));
  const setLiveMicError = (code: LiveMicErrorCode) => setLiveError(LIVE_MIC_ERROR_MESSAGES[code]);
  const stopLivePlayback = () => {
    stopTextSpeech();
    if (liveAudioRef.current) {
      liveAudioRef.current.pause();
      liveAudioRef.current.currentTime = 0;
      liveAudioRef.current = null;
    }
  };
  const interruptLiveOutput = (resumeListening = false) => {
    liveTurnSerialRef.current += 1;
    stopLivePlayback();
    setLiveStatus("idle");
    setLiveSpeakerState("idle");
    setLiveInterim("");

    if (resumeListening && liveControlsEnabled) {
      const mode = liveMicMode === "push" ? "push" : "toggle";
      window.setTimeout(() => {
        void startLiveListening(mode, true);
      }, 120);
    }
  };
  const clearUndoTimer = () => {
    if (undoTimeoutRef.current !== null) {
      window.clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
  };
  const queueUndoNotice = (label: string, undo: () => void) => {
    clearUndoTimer();
    const id = shortId();
    setUndoNotice({ id, label, undo });
    undoTimeoutRef.current = window.setTimeout(() => {
      setUndoNotice((previous) => (previous?.id === id ? null : previous));
      undoTimeoutRef.current = null;
    }, 6000);
  };
  const dismissUndo = () => {
    clearUndoTimer();
    setUndoNotice(null);
  };
  const scrollToLatest = (context: AutoScrollContext) => {
    const element = context === "chat" ? chatThreadRef.current : liveLogRef.current;
    if (!element) {
      return;
    }

    element.scrollTo({
      top: element.scrollHeight,
      behavior: "smooth"
    });
  };

  useEffect(() => {
    if (!currentUser) {
      hydrateUserRef.current = null;
      return;
    }

    if (hydrateUserRef.current === currentUser.id) {
      return;
    }

    const stored = loadSessions(currentUser.id);
    if (stored.length === 0) {
      const session = createSession();
      dispatch({ type: "hydrateSessions", sessions: [session], activeSessionId: session.sessionId });
      hydrateUserRef.current = currentUser.id;
      return;
    }

    const storedActive = loadActiveSessionId(currentUser.id);
    const active = stored.find((item) => item.sessionId === storedActive) ?? stored[0];
    dispatch({ type: "hydrateSessions", sessions: stored, activeSessionId: active.sessionId });
    hydrateUserRef.current = currentUser.id;
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }
    saveSessions(currentUser.id, state.sessions);
  }, [state.sessions, currentUser]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }
    saveActiveSessionId(currentUser.id, state.activeSessionId);
  }, [state.activeSessionId, currentUser]);

  useEffect(() => {
    saveStudioImages(studioItems);
  }, [studioItems]);

  useEffect(() => {
    saveLiveVisualFullscreenPreference(liveVisualFullscreen);
  }, [liveVisualFullscreen]);

  useEffect(() => {
    if (!currentUser) {
      setSelectedLiveVoiceId("");
      return;
    }

    setSelectedLiveVoiceId(loadLiveVoiceSelection(currentUser.id) ?? "");
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser || !selectedLiveVoiceId) {
      return;
    }

    saveLiveVoiceSelection(currentUser.id, selectedLiveVoiceId);
  }, [currentUser?.id, selectedLiveVoiceId]);

  useEffect(() => {
    if (!auth) {
      setServerLiveVoiceOptions([]);
      return;
    }

    let cancelled = false;
    setLiveVoiceLoading(true);

    const loadVoices = async () => {
      try {
        const payload = await fetchLiveVoices(auth.token);
        if (!cancelled) {
          setServerLiveVoiceOptions(payload.voices);
        }
      } catch {
        if (!cancelled) {
          setServerLiveVoiceOptions([]);
        }
      } finally {
        if (!cancelled) {
          setLiveVoiceLoading(false);
        }
      }
    };

    void loadVoices();
    return () => {
      cancelled = true;
    };
  }, [auth?.token]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      setBrowserLiveVoiceOptions([]);
      return;
    }

    const synthesis = window.speechSynthesis;
    let cancelled = false;
    const previousHandler = synthesis.onvoiceschanged;
    let attempt = 0;

    const refresh = () => {
      if (cancelled) {
        return;
      }
      setBrowserLiveVoiceOptions(mapBrowserVoiceOptions());
    };

    refresh();
    void synthesis.getVoices();

    const interval = window.setInterval(() => {
      attempt += 1;
      refresh();
      if (attempt >= 10) {
        window.clearInterval(interval);
      }
    }, 600);

    synthesis.onvoiceschanged = refresh;

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (synthesis.onvoiceschanged === refresh) {
        synthesis.onvoiceschanged = previousHandler ?? null;
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedLiveVoiceId) {
      return;
    }

    if (liveVoiceOptions.some((voice) => voice.id === selectedLiveVoiceId)) {
      return;
    }

    setSelectedLiveVoiceId("");
  }, [liveVoiceOptions, selectedLiveVoiceId]);

  useEffect(
    () => () => {
      clearUndoTimer();
      recognitionStopRequestedRef.current = true;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      stopLivePlayback();
    },
    []
  );

  useEffect(() => {
    const onFullscreenChange = () => {
      setLiveVisualIsFullscreen(document.fullscreenElement === liveTheaterRef.current);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const ping = async () => {
      const online = await checkHealth();
      if (!cancelled) {
        dispatch({ type: "setApiOnline", online });
      }
    };

    void ping();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (panel !== "chat") {
      return;
    }
    scrollToLatest("chat");
  }, [panel, state.activeSessionId, state.pendingTurnId, state.isSending, activeSession?.turns.length]);

  useEffect(() => {
    if (!feedbackNotice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setFeedbackNotice(null);
    }, 6000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [feedbackNotice]);

  useEffect(() => {
    if (panel !== "live" || !liveTheaterActive) {
      return;
    }
    scrollToLatest("live");
  }, [panel, liveTheaterActive, liveTranscript.length, liveInterim, liveStatus]);

  useEffect(() => {
    if (!liveTheaterActive) {
      return;
    }

    const theater = liveTheaterRef.current;
    if (!theater) {
      return;
    }

    if (liveVisualFullscreen && document.fullscreenElement !== theater) {
      void theater.requestFullscreen().catch(() => undefined);
    }

    if (!liveVisualFullscreen && document.fullscreenElement === theater) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [liveTheaterActive, liveVisualFullscreen]);

  useEffect(() => {
    if (liveStatus === "listening") {
      setLiveSpeakerState("user-speaking");
      return;
    }
    if (liveStatus === "processing") {
      setLiveSpeakerState("processing");
      return;
    }
    if (liveStatus === "speaking") {
      setLiveSpeakerState("assistant-speaking");
      return;
    }
    setLiveSpeakerState("idle");
  }, [liveStatus]);

  useEffect(() => {
    if (!liveTheaterActive || panel !== "live") {
      return;
    }
    if (liveIntroState !== "done" || liveWelcomeComplete || liveSafetyAgreementAccepted) {
      return;
    }
    if (liveWelcomeStartedRef.current) {
      return;
    }

    liveWelcomeStartedRef.current = true;
    void speakLiveResponse(LIVE_WELCOME_MESSAGE, {
      force: true,
      onDone: () => {
        setLiveWelcomeComplete(true);
      }
    });
  }, [liveTheaterActive, panel, liveIntroState, liveWelcomeComplete, liveSafetyAgreementAccepted]);

  useEffect(() => {
    if (!liveTheaterActive || panel !== "live") {
      return;
    }
    if (!liveControlsEnabled || liveMicMode !== "toggle" || !liveAutoListenEnabled) {
      return;
    }
    if (liveStatus !== "idle" || recognitionRef.current || pushToTalkActiveRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void startLiveListening("toggle");
    }, 220);

    return () => {
      window.clearTimeout(timer);
    };
  }, [liveTheaterActive, panel, liveControlsEnabled, liveMicMode, liveAutoListenEnabled, liveStatus]);

  useEffect(() => {
    const existing = loadAuth();
    if (!existing) {
      return;
    }

    let cancelled = false;

    const validate = async () => {
      try {
        const [user, permissionMatrix] = await Promise.all([
          fetchMe(existing.token),
          fetchPermissions(existing.token)
        ]);

        if (!cancelled) {
          const next = { token: existing.token, user };
          setAuth(next);
          saveAuth(next.token, next.user);
          setPermissions(permissionMatrix);
        }
      } catch {
        if (!cancelled) {
          clearAuth();
          setAuth(null);
          setPermissions(null);
        }
      }
    };

    void validate();

    return () => {
      cancelled = true;
    };
  }, []);

  const loadTermsAndGuidelines = async () => {
    setLegalBusy(true);
    setLegalError(null);
    try {
      const [termsPayload, guidelinesPayload] = await Promise.all([fetchTerms(), fetchGuidelines()]);
      setTerms(termsPayload);
      setGuidelines(guidelinesPayload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load legal content";
      setLegalError(message);
    } finally {
      setLegalBusy(false);
    }
  };

  const refreshAdmin = async () => {
    if (!auth || !permissions) {
      return;
    }

    setAdminBusy(true);
    setAdminError(null);

    try {
      const reportsPromise = hasPerm("reports:view") ? fetchReports(auth.token) : Promise.resolve([] as SafetyReport[]);
      const usersPromise = hasPerm("users:view") ? fetchUsers(auth.token) : Promise.resolve([] as AuthUser[]);
      const keysPromise = hasPerm("apikeys:view:own") || hasPerm("apikeys:view:any")
        ? fetchApiKeys(auth.token)
        : Promise.resolve([] as ApiKeyMetadata[]);
      const auditPromise = hasPerm("users:view")
        ? fetchAccountAudit(auth.token)
        : Promise.resolve([] as AccountAuditRecord[]);
      const bannedIpsPromise = hasPerm("users:view")
        ? fetchBannedIps(auth.token)
        : Promise.resolve([] as BannedIpRecord[]);

      const [reportList, userList, keyList, auditList, bannedIpList] = await Promise.all([
        reportsPromise,
        usersPromise,
        keysPromise,
        auditPromise,
        bannedIpsPromise
      ]);
      if (hasPerm("reports:view")) {
        const known = knownReportIdsRef.current;
        const reportIds = reportList.map((report) => report.id);

        if (!seededReportIdsRef.current) {
          knownReportIdsRef.current = new Set(reportIds);
          seededReportIdsRef.current = true;
        } else {
          const newItems = reportIds.filter((id) => !known.has(id)).length;
          if (newItems > 0) {
            setAdminIncidentCount((previous) => previous + newItems);
          }
          knownReportIdsRef.current = new Set([...reportIds, ...Array.from(known)]);
        }
      }

      setReports(reportList);
      setUsers(userList);
      setApiKeys(keyList);
      setAccountAudit(auditList);
      setBannedIps(bannedIpList);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load admin data";
      setAdminError(message);
    } finally {
      setAdminBusy(false);
    }
  };

  useEffect(() => {
    if (!auth || !hasPerm("reports:view")) {
      return;
    }

    void refreshAdmin();
    const timer = window.setInterval(() => {
      void refreshAdmin();
    }, 30000);

    return () => {
      window.clearInterval(timer);
    };
  }, [auth, permissions]);

  const submitPrompt = async (text: string, session: ChatSession): Promise<DualChatResponse | null> => {
    const cleanText = text.trim();
    if (!cleanText || state.isSending) {
      return null;
    }

    if (!auth) {
      dispatch({ type: "sendFailure", turnId: shortId(), error: "Please sign in to use chat" });
      return null;
    }

    const turn: ChatTurn = {
      id: shortId(),
      userText: cleanText,
      createdAt: nowIso()
    };

    const history = buildHistory(session);

    dispatch({ type: "sendStart", turn });

    try {
      const response = await sendDualChat(
        {
          sessionId: session.sessionId,
          message: cleanText,
          history,
          clientNowIso: nowIso(),
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          clientLocale: navigator.language
        },
        auth.token
      );

      dispatch({ type: "sendSuccess", turnId: turn.id, response });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not reach service";
      const userMessage = showDiagnosticDetails ? message : USER_SAFE_FAILURE_MESSAGE;

      if (message.toLowerCase().includes("authentication")) {
        clearAuth();
        setAuth(null);
        setPermissions(null);
      }

      dispatch({ type: "sendFailure", turnId: turn.id, error: userMessage });
      return null;
    }
  };

  const handleSend = async () => {
    if (!activeSession) {
      return;
    }
    await submitPrompt(state.input, activeSession);
  };

  const handleRetry = async (turn: ChatTurn) => {
    if (!activeSession || state.isSending) {
      return;
    }

    dispatch({ type: "clearError" });

    const previousTurns = activeSession.turns.filter((item) => item.id !== turn.id);
    const snapshot: ChatSession = {
      ...activeSession,
      turns: previousTurns
    };

    await submitPrompt(turn.userText, snapshot);
  };

  const handleComposerKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const confirmClear = () => {
    if (window.confirm("Clear all saved chats?")) {
      dispatch({ type: "clearSessions" });
      dismissUndo();
    }
  };

  const handleDeleteTurn = (turn: ChatTurn) => {
    if (!activeSession) {
      return;
    }

    const index = activeSession.turns.findIndex((entry) => entry.id === turn.id);
    if (index < 0) {
      return;
    }

    dispatch({ type: "deleteTurn", sessionId: activeSession.sessionId, turnId: turn.id });
    queueUndoNotice("Message deleted.", () => {
      dispatch({ type: "restoreTurn", sessionId: activeSession.sessionId, turn, index });
    });
  };

  const handleDeleteSession = (session: ChatSession, index: number) => {
    dispatch({ type: "deleteSession", sessionId: session.sessionId, index });
    queueUndoNotice("Chat deleted.", () => {
      dispatch({ type: "restoreSession", session, index });
    });
  };

  const handleUndo = () => {
    if (!undoNotice) {
      return;
    }
    const undo = undoNotice.undo;
    dismissUndo();
    undo();
  };

  const handleAuthSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError(null);

    try {
      const payload =
        authMode === "signin"
          ? await signIn(authEmail.trim(), authPassword)
          : await signUp(authEmail.trim(), authPassword);

      const permissionMatrix = await fetchPermissions(payload.token);
      setPermissions(permissionMatrix);
      setAuth(payload);
      saveAuth(payload.token, payload.user);
      setAuthPassword("");
      setPanel("chat");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed";
      setAuthError(message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (auth) {
      await signOut(auth.token);
    }
    clearAuth();
    setAuth(null);
    setPermissions(null);
    stopLiveListening();
    setLiveTheaterActive(false);
    setLiveVoiceConfirmed(false);
    setLiveIntroState("idle");
    setLiveWelcomeComplete(false);
    setLiveSafetyAgreementChecked(false);
    setLiveSafetyAgreementAccepted(false);
    setLiveAutoListenEnabled(true);
    liveWelcomeStartedRef.current = false;
    setAdminIncidentCount(0);
    knownReportIdsRef.current = new Set();
    seededReportIdsRef.current = false;
    setReports([]);
    setUsers([]);
    setApiKeys([]);
    setAccountAudit([]);
    setBannedIps([]);
    setFeedbackOpen(false);
    setFeedbackMessage("");
    setFeedbackNotice(null);
    dismissUndo();
    setPanel("chat");
  };

  const openPanel = async (nextPanel: PanelMode) => {
    setPanel(nextPanel);

    if (nextPanel === "live") {
      setLiveTheaterActive(true);
      setLiveVoiceConfirmed(false);
      setSelectedLiveVoiceId("");
      setLiveIntroState("idle");
      setLiveAutoListenEnabled(true);
      if (!liveSafetyAgreementAccepted) {
        setLiveWelcomeComplete(false);
        setLiveSafetyAgreementChecked(false);
        liveWelcomeStartedRef.current = false;
      }
      setLiveVisualFullscreen(true);
      setLiveError(null);
      return;
    }

    setLiveTheaterActive(false);
    setLiveVoiceConfirmed(false);
    setLiveIntroState("idle");

    stopLiveListening();
    if (document.fullscreenElement === liveTheaterRef.current) {
      await document.exitFullscreen().catch(() => undefined);
    }
    if (liveStatus !== "processing") {
      setLiveStatus("idle");
    }
    setLiveSpeakerState("idle");

    if (nextPanel === "terms" || nextPanel === "guidelines") {
      if (!terms || !guidelines) {
        await loadTermsAndGuidelines();
      }
    }

    if (nextPanel === "admin") {
      setAdminIncidentCount(0);
      await refreshAdmin();
    }
  };

  const handleReportStatusChange = async (reportId: string, status: "new" | "reviewed" | "closed") => {
    if (!auth) {
      return;
    }

    setAdminError(null);
    try {
      await updateReportStatus(auth.token, reportId, status);
      await refreshAdmin();
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Could not update report");
    }
  };

  const handleCreateUser = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth) {
      return;
    }

    setAdminError(null);
    try {
      await createUserAsAdmin(auth.token, {
        email: newUserEmail.trim(),
        password: newUserPassword,
        role: newUserRole
      });
      setNewUserEmail("");
      setNewUserPassword("");
      await refreshAdmin();
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Could not create user");
    }
  };

  const handleCreateApiKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth) {
      return;
    }

    setAdminError(null);
    setCreatedApiKey(null);

    try {
      const response = await createApiKey(auth.token, {
        label: apiKeyLabel.trim(),
        ownerEmail: hasPerm("apikeys:create:any") && apiKeyOwnerEmail.trim() ? apiKeyOwnerEmail.trim() : undefined
      });

      setCreatedApiKey(response.apiKey);
      setApiKeyLabel("External Integration Key");
      setApiKeyOwnerEmail("");
      await refreshAdmin();
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Could not create access key");
    }
  };

  const handleRevokeApiKey = async (apiKeyId: string) => {
    if (!auth) {
      return;
    }

    setAdminError(null);
    try {
      await revokeApiKey(auth.token, apiKeyId);
      await refreshAdmin();
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Could not revoke access key");
    }
  };

  const handleSubmitFeedback = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth || !feedbackMessage.trim()) {
      return;
    }

    setFeedbackBusy(true);
    setFeedbackNotice(null);

    try {
      await submitFeedbackReport(auth.token, {
        message: feedbackMessage.trim(),
        page: panel
      });
      setFeedbackNotice("Thanks, your beta feedback was sent to staff.");
      setFeedbackMessage("");
      setFeedbackOpen(false);
      if (hasPerm("reports:view")) {
        await refreshAdmin();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send feedback";
      setFeedbackNotice(showDiagnosticDetails ? message : USER_SAFE_FAILURE_MESSAGE);
    } finally {
      setFeedbackBusy(false);
    }
  };

  const handleRunTerminal = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth) {
      return;
    }

    setTerminalBusy(true);
    setAdminError(null);

    try {
      const result = await executeFounderCommand(auth.token, terminalCommand);
      setTerminalOutput([
        `$ ${result.command}`,
        result.stdout.trim() ? result.stdout : "",
        result.stderr.trim() ? result.stderr : "",
        `[exit ${result.exitCode}]`
      ].filter((line) => line.length > 0).join("\n"));
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : "Command failed");
    } finally {
      setTerminalBusy(false);
    }
  };

  const handleCopyEmbedSnippet = async () => {
    if (!navigator.clipboard) {
      return;
    }

    const snippet = [
      "curl -s -X POST http://localhost:3000/api/external/chat/dual \\",
      "  -H \"Content-Type: application/json\" \\",
      "  -H \"x-aries-api-key: YOUR_ADMIN_OR_STAFF_KEY\" \\",
      "  -d '{\"sessionId\":\"external-session\",\"message\":\"Hello from my site\",\"history\":[]}'"
    ].join("\n");
    await navigator.clipboard.writeText(snippet);
    setFeedbackNotice("Assistant integration snippet copied.");
  };

  const mapImageResponseToStudioItems = (response: ImageGenerationResponse): StudioImageItem[] =>
    response.images.map((image) => ({
      id: shortId(),
      prompt: response.prompt,
      createdAt: response.timestamp,
      model: response.model,
      latencyMs: response.latencyMs,
      note: response.text,
      mimeType: image.mimeType,
      dataUrl: `data:${image.mimeType};base64,${image.base64}`
    }));

  const handleGenerateImage = async (event: FormEvent) => {
    event.preventDefault();

    if (!auth || !activeSession || studioBusy || !studioPrompt.trim()) {
      return;
    }

    setStudioError(null);
    setStudioBusy(true);

    try {
      const response = await generateImage(
        {
          sessionId: activeSession.sessionId,
          prompt: studioPrompt.trim(),
          count: studioCount
        },
        auth.token
      );

      if (!response.ok) {
        setStudioError(showDiagnosticDetails ? response.error ?? "Image generation failed" : USER_SAFE_FAILURE_MESSAGE);
        return;
      }

      const generated = mapImageResponseToStudioItems(response);
      setStudioItems((previous) => [...generated, ...previous].slice(0, 60));
      setStudioPrompt("");

      if (response.error && showDiagnosticDetails) {
        setStudioError(response.error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image generation failed";
      setStudioError(showDiagnosticDetails ? message : USER_SAFE_FAILURE_MESSAGE);
    } finally {
      setStudioBusy(false);
    }
  };

  const handleGenerateCodeIdea = async (event: FormEvent) => {
    event.preventDefault();

    if (!auth || codeBusy || !codePrompt.trim()) {
      return;
    }

    setCodeBusy(true);
    setCodeError(null);

    const trimmedPrompt = codePrompt.trim();
    const trimmedFramework = codeFramework.trim();
    const codeHistory: HistoryMessage[] = codeItems.slice(-8).flatMap((item) => [
      { role: "user", content: item.prompt },
      { role: "assistant", content: item.responseText }
    ]);

    const codeMessage = [
      "You are Aries Code Lab. Generate clean, production-minded code with concise explanation.",
      `Primary language: ${codeLanguage}.`,
      trimmedFramework ? `Framework or stack target: ${trimmedFramework}.` : "",
      "Return:",
      "1) Implementation",
      "2) How to run",
      "3) Minimal tests",
      "4) Useful direct website links and, when relevant, YouTube learning links.",
      `User request: ${trimmedPrompt}`
    ]
      .filter((line) => line.length > 0)
      .join("\n");

    try {
      const response = await sendDualChat(
        {
          sessionId: `code-lab-${auth.user.id}`,
          message: codeMessage,
          history: codeHistory,
          clientNowIso: nowIso(),
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          clientLocale: navigator.language
        },
        auth.token
      );

      const responseText =
        (response.pro.ok ? response.pro.text.trim() : "") ||
        (response.flash.ok ? response.flash.text.trim() : "") ||
        response.pro.error ||
        response.flash.error ||
        "";

      if (!responseText) {
        setCodeError(USER_SAFE_FAILURE_MESSAGE);
        return;
      }

      const latencyCandidates = [response.pro.latencyMs, response.flash.latencyMs].filter(
        (value): value is number => typeof value === "number" && value > 0
      );
      const latencyMs =
        latencyCandidates.length > 0
          ? Math.round(latencyCandidates.reduce((sum, value) => sum + value, 0) / latencyCandidates.length)
          : undefined;

      setCodeItems((previous) => [
        {
          id: shortId(),
          prompt: trimmedPrompt,
          language: codeLanguage,
          framework: trimmedFramework,
          responseText,
          createdAt: response.timestamp,
          latencyMs,
          blocked: response.blocked,
          reportId: response.reportId
        },
        ...previous
      ]);
      setCodePrompt("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Code generation failed";
      setCodeError(showDiagnosticDetails ? message : USER_SAFE_FAILURE_MESSAGE);
    } finally {
      setCodeBusy(false);
    }
  };

  const handleCopyCodeResult = async (text: string) => {
    if (!navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(text);
  };

  const speakLiveResponse = async (
    text: string,
    options?: {
      force?: boolean;
      onDone?: () => void;
    }
  ) => {
    if (!options?.force && !liveVoiceEnabled) {
      setLiveStatus("idle");
      options?.onDone?.();
      return;
    }

    let settled = false;
    const prefersBrowserVoice = selectedLiveVoice?.provider === "browser";
    const selectedElevenVoiceId = selectedLiveVoice?.provider === "elevenlabs" ? selectedLiveVoice.voiceId : undefined;
    const selectedBrowserVoiceName = selectedLiveVoice?.provider === "browser" ? selectedLiveVoice.browserVoiceName : undefined;
    const selectedBrowserVoiceLang = selectedLiveVoice?.provider === "browser" ? selectedLiveVoice.lang : undefined;
    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      setLiveStatus("idle");
      options?.onDone?.();
    };

    const speakWithElevenLabs = async (): Promise<boolean> => {
      if (!auth || prefersBrowserVoice) {
        return false;
      }

      try {
        const tts = await synthesizeLiveVoice(text, auth.token, selectedElevenVoiceId);
        const audio = new Audio(`data:${tts.mimeType};base64,${tts.audioBase64}`);
        liveAudioRef.current = audio;
        setLiveStatus("speaking");
        audio.onended = () => {
          liveAudioRef.current = null;
          settle();
        };
        audio.onerror = () => {
          liveAudioRef.current = null;
          settle();
        };
        await audio.play();
        return true;
      } catch {
        return false;
      }
    };

    const playedByElevenLabs = await speakWithElevenLabs();
    if (playedByElevenLabs) {
      return;
    }

    const spoken = speakText(text, {
      rate: 0.9,
      pitch: 0.95,
      volume: 0.95,
      voiceName: selectedBrowserVoiceName,
      voiceLang: selectedBrowserVoiceLang,
      onStart: () => setLiveStatus("speaking"),
      onEnd: settle
    });

    if (!spoken) {
      settle();
    }
  };

  const runLiveTurn = async (spokenText: string) => {
    if (!activeSession || !spokenText.trim()) {
      return;
    }

    const turnSerial = liveTurnSerialRef.current + 1;
    liveTurnSerialRef.current = turnSerial;
    setLiveError(null);
    setLiveStatus("processing");

    const response = await submitPrompt(spokenText, activeSession);
    if (turnSerial !== liveTurnSerialRef.current) {
      return;
    }

    setLiveTranscript((previous) => [
      ...previous,
      { id: shortId(), role: "user", text: spokenText, timestamp: nowIso() }
    ]);

    if (!response) {
      setLiveStatus("idle");
      return;
    }

    const assistantText =
      (response.flash.ok ? response.flash.text : "") ||
      (response.pro.ok ? response.pro.text : "") ||
      response.flash.error ||
      response.pro.error ||
      "No answer returned.";
    const userFacingAssistantText = showDiagnosticDetails ? assistantText : assistantText || USER_SAFE_FAILURE_MESSAGE;

    setLiveTranscript((previous) => [
      ...previous,
      { id: shortId(), role: "assistant", text: userFacingAssistantText, timestamp: nowIso() }
    ]);
    setLiveInterim("");

    if (userFacingAssistantText.trim().length > 0) {
      void speakLiveResponse(userFacingAssistantText);
    } else {
      setLiveStatus("idle");
    }
  };

  const stopLiveListening = () => {
    liveTurnSerialRef.current += 1;
    recognitionStopRequestedRef.current = true;
    pushToTalkActiveRef.current = false;
    setPushToTalkActive(false);
    liveListenModeRef.current = "toggle";
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    stopLivePlayback();
    setLiveStatus("idle");
    setLiveInterim("");
  };

  const ensureMicrophoneAccess = async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setLiveMicError("unsupported");
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setLiveMicError("not-allowed");
        return false;
      }

      if (error instanceof DOMException && error.name === "NotFoundError") {
        setLiveMicError("not-found");
        return false;
      }

      setLiveMicError("start-failed");
      return false;
    }
  };

  const toggleLiveVisualFullscreen = async () => {
    const theater = liveTheaterRef.current;
    const nextEnabled = !liveVisualFullscreen;
    setLiveVisualFullscreen(nextEnabled);

    if (!theater) {
      return;
    }

    try {
      if (!nextEnabled && document.fullscreenElement === theater) {
        await document.exitFullscreen();
      } else if (nextEnabled && document.fullscreenElement !== theater) {
        await theater.requestFullscreen();
      }
    } catch {
      setLiveError("Fullscreen mode is not available in this browser.");
    }
  };

  const startLiveListening = async (mode: "toggle" | "push" = liveMicMode, preserveInput = false) => {
    if (!liveControlsEnabled) {
      return;
    }

    if (liveStatus === "speaking") {
      interruptLiveOutput(false);
    }

    if (liveStatus === "listening" || liveStatus === "processing") {
      return;
    }

    const RecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!RecognitionCtor) {
      setLiveMicError("unsupported");
      return;
    }

    const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (!window.isSecureContext && !isLocalhost) {
      setLiveMicError("insecure-context");
      return;
    }

    const hasMic = await ensureMicrophoneAccess();
    if (!hasMic) {
      return;
    }

    setLiveError(null);
    if (!preserveInput) {
      finalVoiceInputRef.current = "";
    }
    liveListenModeRef.current = mode;
    recognitionStopRequestedRef.current = false;

    const recognition = new RecognitionCtor();
    recognition.continuous = mode === "push";
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setLiveStatus("listening");
      setLiveInterim("");
    };

    recognition.onresult = (event) => {
      let interimText = "";
      let finalText = finalVoiceInputRef.current;

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText = `${finalText} ${transcript}`.trim();
        } else {
          interimText = `${interimText} ${transcript}`.trim();
        }
      }

      finalVoiceInputRef.current = finalText;
      setLiveInterim(interimText);
      if (finalText) {
        setLiveDraft(finalText);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted" && recognitionStopRequestedRef.current) {
        setLiveStatus("idle");
        setLiveInterim("");
        return;
      }

      if (event.error === "no-speech") {
        setLiveStatus("idle");
        setLiveInterim("");
        return;
      }

      setLiveStatus("idle");
      const code = micErrorCodeFromRecognitionError(event.error);
      setLiveMicError(code);
      setLiveInterim("");
    };

    recognition.onend = () => {
      const spokenText = finalVoiceInputRef.current.trim();
      const wasPushMode = liveListenModeRef.current === "push";
      const stopRequested = recognitionStopRequestedRef.current;
      recognitionRef.current = null;
      recognitionStopRequestedRef.current = false;

      if (wasPushMode && pushToTalkActiveRef.current && !stopRequested) {
        void startLiveListening("push", true);
        return;
      }

      if (!spokenText) {
        setLiveStatus("idle");
        setLiveInterim("");
        return;
      }

      void runLiveTurn(spokenText);
    };

    recognitionRef.current = recognition;
    const startRecognition = (canRetry: boolean) => {
      try {
        recognition.start();
      } catch (error) {
        if (canRetry && error instanceof DOMException && error.name === "InvalidStateError") {
          window.setTimeout(() => startRecognition(false), 140);
          return;
        }
        setLiveStatus("idle");
        setLiveMicError("start-failed");
        recognitionRef.current = null;
      }
    };
    startRecognition(true);
  };

  const handleMicModeChange = (mode: "toggle" | "push") => {
    if (mode === liveMicMode) {
      return;
    }

    stopLiveListening();
    setLiveMicMode(mode);
    setLiveError(null);
  };

  const handleToggleAutoListen = (enabled: boolean) => {
    setLiveAutoListenEnabled(enabled);
    setLiveError(null);

    if (!enabled) {
      stopLiveListening();
      return;
    }

    if (liveControlsEnabled && liveMicMode === "toggle" && liveStatus === "idle") {
      void startLiveListening("toggle");
    }
  };

  const handlePushToTalkStart = () => {
    if (!liveControlsEnabled) {
      return;
    }

    if (liveStatus === "processing") {
      return;
    }

    if (liveStatus === "speaking") {
      interruptLiveOutput(false);
    }
    if (pushToTalkActiveRef.current) {
      return;
    }

    pushToTalkActiveRef.current = true;
    setPushToTalkActive(true);
    void startLiveListening("push");
  };

  const handlePushToTalkEnd = () => {
    if (!pushToTalkActiveRef.current) {
      return;
    }

    pushToTalkActiveRef.current = false;
    setPushToTalkActive(false);
    recognitionStopRequestedRef.current = true;
    recognitionRef.current?.stop();
  };

  const handleLiveSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const spokenText = liveDraft.trim();
    if (!spokenText) {
      return;
    }

    if (liveStatus === "speaking") {
      interruptLiveOutput(false);
    }

    setLiveDraft("");
    await runLiveTurn(spokenText);
  };

  const handleLiveIntroDone = () => {
    setLiveIntroState("done");
    setLiveError(null);
  };

  const handleLiveIntroError = () => {
    setLiveIntroState("error");
  };

  const handleStartLiveSession = () => {
    if (!hasSelectedLiveVoice) {
      setLiveError("Choose a voice profile before starting Aries Live.");
      return;
    }
    setLiveVoiceConfirmed(true);
    setLiveIntroState("playing");
    setLiveError(null);
  };

  const handleLiveSafetyAgreementContinue = () => {
    if (!liveSafetyAgreementChecked) {
      return;
    }
    setLiveSafetyAgreementAccepted(true);
    setLiveError(null);
    void speakLiveResponse(LIVE_AGREEMENT_ACCEPTED_MESSAGE, {
      force: true
    });
  };

  const handleLiveVoiceChange = (voiceOptionId: string) => {
    setSelectedLiveVoiceId(voiceOptionId);
    setLiveError(null);
  };

  const handlePreviewLiveVoice = () => {
    if (liveStatus === "speaking") {
      interruptLiveOutput(false);
    }

    if (!liveVoiceEnabled) {
      setLiveVoiceEnabled(true);
    }

    void speakLiveResponse("Hello, I'm Aries. This is your selected voice profile.", {
      force: true
    });
  };

  const handleInterruptLive = () => {
    interruptLiveOutput(true);
  };

  const handleExitLive = () => {
    liveTurnSerialRef.current += 1;
    stopLiveListening();
    setLiveTheaterActive(false);
    setLiveVoiceConfirmed(false);
    setLiveIntroState("idle");
    setLiveStatus("idle");
    setLiveSpeakerState("idle");
    setLiveInterim("");
    setPanel("chat");
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  };

  const formatLiveTimestamp = (iso: string) =>
    new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });

  const canSeeAdminPanel =
    hasPerm("reports:view") ||
    hasPerm("users:view") ||
    hasPerm("apikeys:view:own") ||
    hasPerm("apikeys:view:any") ||
    hasPerm("terminal:execute");
  const showSessionRail = panel === "chat" || panel === "studio" || panel === "code";

  useEffect(() => {
    if (panel === "live" && !liveTheaterActive) {
      setPanel("chat");
    }
  }, [panel, liveTheaterActive]);

  useEffect(() => {
    if (panel === "live") {
      return;
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [panel]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const root = document.documentElement;
      root.style.setProperty("--pointer-x", `${event.clientX}px`);
      root.style.setProperty("--pointer-y", `${event.clientY}px`);
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, []);

  const creatableRoles = useMemo<Array<Exclude<UserRole, "founder">>>(
    () => [
      ...(hasPerm("users:create:user") ? ["user" as const] : []),
      ...(hasPerm("users:create:staff") ? ["staff" as const] : []),
      ...(hasPerm("users:create:admin") ? ["admin" as const] : [])
    ],
    [permissions]
  );

  useEffect(() => {
    if (creatableRoles.length === 0) {
      return;
    }

    if (!creatableRoles.includes(newUserRole)) {
      setNewUserRole(creatableRoles[0]);
    }
  }, [creatableRoles, newUserRole]);

  if (!currentUser) {
    return (
      <div className="app-bg">
        <video className="bg-video" autoPlay loop muted playsInline preload="auto" aria-hidden="true">
          <source src="/media/galaxy-loop.mp4" type="video/mp4" />
        </video>
        <div className="noise" />
        <div className="auth-shell">
          <section className="auth-card">
            <div className="auth-brand">
              <AriesLogo className="brand-logo" />
              <p className="eyebrow">Aries</p>
            </div>
            <h1>Sign In to Aries</h1>
            <p className="auth-copy">
              Create an account or sign in to access Aries chat, live voice theater, image generation, and role controls.
            </p>
            <p className="card-meta">Created and designed by MAXX FORGE STUDIO.</p>

            <form onSubmit={handleAuthSubmit} className="auth-form">
              <label>
                Email
                <input
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>

              <label>
                Password
                <input
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  type="password"
                  autoComplete={authMode === "signin" ? "current-password" : "new-password"}
                  required
                />
              </label>

              {authError ? <div className="global-error">{authError}</div> : null}

              <button type="submit" className="primary-btn" disabled={authBusy}>
                {authBusy ? "Please wait..." : authMode === "signin" ? "Sign In" : "Create Account"}
              </button>
            </form>

            <div className="auth-switch-row">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setAuthMode(authMode === "signin" ? "signup" : "signin")}
              >
                {authMode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
              </button>
            </div>

              <div className="founder-note">
                <strong>System accounts are seeded from <code>server/.env</code>:</strong>
                <br />Founder: <code>FOUNDER_EMAIL</code> / <code>FOUNDER_PASSWORD</code>
                <br />Admin: <code>ADMIN_EMAIL</code> / <code>ADMIN_PASSWORD</code>
                <br />Monitor (staff): <code>MONITOR_EMAIL</code> / <code>MONITOR_PASSWORD</code>
                <br />
                <small>Passwords sync from <code>server/.env</code> each time the server starts.</small>
              </div>

            <div className="legal-actions">
              <button type="button" className="ghost-btn" onClick={() => void loadTermsAndGuidelines()}>
                Load Terms & Guidelines
              </button>
            </div>

            {legalBusy ? <p className="card-muted">Loading legal content...</p> : null}
            {legalError ? <div className="global-error">{legalError}</div> : null}

            {terms ? (
              <div className="legal-pane">
                <h3>{terms.title}</h3>
                <p className="message-time">
                  Version {terms.version} - Updated {terms.updatedAt}
                </p>
                {terms.content.map((line, index) => (
                  <p key={`terms-${index}`} className="card-muted">
                    {line}
                  </p>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    );
  }

  if (panel === "live" && liveTheaterActive) {
    const micStatusLabel =
      liveStatus === "idle"
        ? "Idle"
        : liveStatus === "listening"
          ? "Listening"
          : liveStatus === "processing"
            ? "Processing"
            : "Speaking";

    return (
      <div className="app-bg live-shell">
        <video className="bg-video" autoPlay loop muted playsInline preload="auto" aria-hidden="true">
          <source src="/media/galaxy-loop.mp4" type="video/mp4" />
        </video>
        <div className="noise" />
        <LiveTheater
          theaterRef={liveTheaterRef}
          statusLabel={liveStatusLabel}
          micStatusLabel={micStatusLabel}
          speakerState={liveSpeakerState}
          introState={liveIntroState}
          voiceEnabled={liveVoiceEnabled}
          voiceOptions={liveVoiceOptions}
          selectedVoiceId={selectedLiveVoiceId}
          voiceLoading={liveVoiceLoading}
          isListening={liveStatus === "listening"}
          isProcessing={liveStatus === "processing"}
          micMode={liveMicMode}
          autoListenEnabled={liveAutoListenEnabled}
          pushToTalkActive={pushToTalkActive}
          fullscreenEnabled={liveVisualFullscreen}
          fullscreenActive={liveVisualIsFullscreen}
          liveControlsEnabled={liveControlsEnabled}
          showVoiceGate={showLiveVoiceGate}
          canStartSession={hasSelectedLiveVoice}
          canInterrupt={liveStatus === "speaking" || liveStatus === "processing"}
          showSafetyAgreement={showLiveSafetyAgreement}
          safetyAgreementChecked={liveSafetyAgreementChecked}
          onSafetyAgreementCheckedChange={setLiveSafetyAgreementChecked}
          onSafetyAgreementContinue={handleLiveSafetyAgreementContinue}
          onToggleAutoListen={handleToggleAutoListen}
          onMicModeChange={handleMicModeChange}
          onPushToTalkStart={handlePushToTalkStart}
          onPushToTalkEnd={handlePushToTalkEnd}
          onInterrupt={handleInterruptLive}
          onToggleVoice={setLiveVoiceEnabled}
          onVoiceChange={handleLiveVoiceChange}
          onPreviewVoice={handlePreviewLiveVoice}
          onStartSession={handleStartLiveSession}
          onToggleFullscreen={() => void toggleLiveVisualFullscreen()}
          onExit={handleExitLive}
          onIntroDone={handleLiveIntroDone}
          onIntroError={handleLiveIntroError}
        />
      </div>
    );
  }

  return (
    <div className="app-bg">
      <video className="bg-video" autoPlay loop muted playsInline preload="auto" aria-hidden="true">
        <source src="/media/galaxy-loop.mp4" type="video/mp4" />
      </video>
      <div className="noise" />
      <div className="top-island-wrap">
        <section className="aries-island aries-island-top" aria-label="Aries Island">
          <div className="aries-island-body">
            <div className="island-brand-pill" aria-hidden="true">
              <AriesLogo className="island-logo" />
              <span>ARIES</span>
            </div>
            <nav className="dynamic-island-nav" aria-label="Aries navigation">
              <button
                type="button"
                className={panel === "chat" ? "primary-btn" : "ghost-btn"}
                onClick={() => void openPanel("chat")}
              >
                Chat
              </button>
              <button
                type="button"
                className={panel === "studio" ? "primary-btn" : "ghost-btn"}
                onClick={() => void openPanel("studio")}
              >
                Image Studio
              </button>
              <button
                type="button"
                className={panel === "code" ? "primary-btn" : "ghost-btn"}
                onClick={() => void openPanel("code")}
              >
                Code Lab
              </button>
              <button
                type="button"
                className={panel === "live" ? "primary-btn" : "ghost-btn"}
                onClick={() => void openPanel("live")}
              >
                Aries Live
              </button>
              {canSeeAdminPanel ? (
                <button
                  type="button"
                  className={panel === "admin" ? "primary-btn" : "ghost-btn"}
                  onClick={() => void openPanel("admin")}
                >
                  {adminIncidentCount > 0 ? `Admin (${adminIncidentCount})` : "Admin"}
                </button>
              ) : null}
              <button
                type="button"
                className={panel === "terms" ? "primary-btn" : "ghost-btn"}
                onClick={() => void openPanel("terms")}
              >
                Terms
              </button>
              <button
                type="button"
                className={panel === "guidelines" ? "primary-btn" : "ghost-btn"}
                onClick={() => void openPanel("guidelines")}
              >
                Guidelines
              </button>
              <button type="button" className="ghost-btn" onClick={() => void handleSignOut()}>
                Sign Out
              </button>
              {hasPerm("reports:create:feedback") ? (
                <button
                  type="button"
                  className={feedbackOpen ? "primary-btn" : "ghost-btn"}
                  onClick={() => {
                    setFeedbackOpen((previous) => !previous);
                    setFeedbackNotice(null);
                  }}
                >
                  Report Issue
                </button>
              ) : null}
            </nav>

            {showSessionRail ? (
              <div className="session-toolbar">
                <button type="button" className="primary-btn" onClick={() => dispatch({ type: "createSession" })}>
                  New Chat
                </button>
                <button type="button" className="ghost-btn" onClick={confirmClear}>
                  Clear All
                </button>
              </div>
            ) : null}
          </div>
        </section>
      </div>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="aries-identity">
              <AriesLogo className="brand-logo" />
              <div>
                <p className="eyebrow">Aries</p>
                <h1>Command Suite</h1>
              </div>
            </div>
            <p className="brand-tagline">Private AI workspace for chat, live voice, and image design.</p>
            <p className={`status ${state.apiOnline ? "online" : "offline"}`}>
              {state.apiOnline ? "System Online" : "System Offline"}
            </p>
            <p className="card-meta">
              {currentUser.email} - {currentUser.role}
            </p>
          </div>

          {feedbackOpen ? (
            <section className="feedback-card">
              <p className="message-label">Beta Feedback</p>
              <form className="feedback-form" onSubmit={handleSubmitFeedback}>
                <textarea
                  className="composer feedback-input"
                  rows={4}
                  value={feedbackMessage}
                  onChange={(event) => setFeedbackMessage(event.target.value)}
                  placeholder="Share a bug, confusing behavior, or improvement idea..."
                  minLength={5}
                  maxLength={2000}
                  required
                />
                <div className="feedback-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => {
                      setFeedbackOpen(false);
                      setFeedbackMessage("");
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="primary-btn" disabled={feedbackBusy || !feedbackMessage.trim()}>
                    {feedbackBusy ? "Sending..." : "Send Report"}
                  </button>
                </div>
              </form>
            </section>
          ) : null}
          {feedbackNotice ? <div className="inline-notice">{feedbackNotice}</div> : null}

          {showSessionRail ? (
            <>
              <div className="session-list">
                {state.sessions.map((session, index) => (
                  <div key={session.sessionId} className={`session-item ${session.sessionId === state.activeSessionId ? "active" : ""}`}>
                    <button
                      type="button"
                      className="session-open-btn"
                      onClick={() => dispatch({ type: "setActiveSession", sessionId: session.sessionId })}
                    >
                      <span>{session.title}</span>
                      <small>{new Date(session.updatedAt).toLocaleDateString()}</small>
                    </button>
                    <button
                      type="button"
                      className="session-delete-btn"
                      onClick={() => handleDeleteSession(session, index)}
                      aria-label={`Delete chat ${session.title}`}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
              <p className="soon-note">More features coming soon.</p>
            </>
          ) : null}

          <section className="social-hub" aria-label="Maxx Forge Studio links">
            <p className="message-label">MAXX FORGE STUDIO</p>
            <p className="card-muted">Created and designed by MAXX FORGE STUDIO. Property of Maxx Forge Studio.</p>
            <a className="social-link" href="https://www.instagram.com/maxxforgestudio/" target="_blank" rel="noreferrer">
              <span className="social-icon" aria-hidden="true">
                IG
              </span>
              <span>Instagram</span>
              <span className="social-cta">Join</span>
            </a>
            <a className="social-link" href="https://discord.gg/KNPSqDV8ZY" target="_blank" rel="noreferrer">
              <span className="social-icon" aria-hidden="true">
                DC
              </span>
              <span>Discord</span>
              <span className="social-cta">Join</span>
            </a>
            <a className="social-link" href="tel:+14154830648">
              <span className="social-icon" aria-hidden="true">
                PH
              </span>
              <span>(415) 483-0648</span>
              <span className="social-cta">Call</span>
            </a>
          </section>
        </aside>

        <main className="chat-panel">
          {panel === "chat" ? (
            <>
              <header className="chat-header">
                <h2>Aries conversation workspace</h2>
                <p>One polished response per turn, with lane details available when you want them.</p>
              </header>

              {showDiagnosticDetails && state.globalError ? <div className="global-error">{state.globalError}</div> : null}

              <section className="chat-thread" aria-live="polite" ref={chatThreadRef}>
                {activeSession?.turns.length ? (
                  activeSession.turns.map((turn) => (
                    <TurnRow
                      key={turn.id}
                      turn={turn}
                      pending={state.pendingTurnId === turn.id}
                      onRetry={() => void handleRetry(turn)}
                      onDelete={() => handleDeleteTurn(turn)}
                      hideFailureDetails={!showDiagnosticDetails}
                    />
                  ))
                ) : (
                  <div className="empty-state">
                    <p>Start your first prompt to compare your configured model lanes side by side.</p>
                  </div>
                )}
              </section>

              <footer className="composer-wrap">
                <textarea
                  value={state.input}
                  onChange={(event) => dispatch({ type: "setInput", value: event.target.value })}
                  onKeyDown={handleComposerKeyDown}
                  className="composer"
                  rows={3}
                  placeholder="Ask anything..."
                  disabled={state.isSending}
                />
                <button
                  type="button"
                  className="primary-btn send-btn"
                  onClick={() => void handleSend()}
                  disabled={state.isSending || !state.input.trim()}
                >
                  {state.isSending ? "Thinking..." : "Send"}
                </button>
              </footer>
            </>
          ) : null}

          {panel === "studio" ? (
            <section className="panel-view">
              <header className="chat-header">
                <h2>Image Studio</h2>
                <p>Generate images from prompts and export assets for your projects.</p>
              </header>

              <div className="chat-thread">
                <section className="studio-form-card">
                  <form className="studio-form" onSubmit={handleGenerateImage}>
                    <label>
                      Prompt
                      <textarea
                        className="composer"
                        rows={4}
                        placeholder="Describe the image you want..."
                        value={studioPrompt}
                        onChange={(event) => setStudioPrompt(event.target.value)}
                        disabled={studioBusy}
                      />
                    </label>

                    <div className="studio-controls">
                      <label>
                        Variations
                        <select
                          value={studioCount}
                          onChange={(event) => setStudioCount(Number(event.target.value))}
                          disabled={studioBusy}
                        >
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                          <option value={4}>4</option>
                        </select>
                      </label>

                      <button type="submit" className="primary-btn" disabled={studioBusy || !studioPrompt.trim()}>
                        {studioBusy ? "Rendering..." : "Generate Image"}
                      </button>
                    </div>
                  </form>
                </section>

                {showDiagnosticDetails && studioError ? <div className="global-error">{studioError}</div> : null}

                {studioItems.length === 0 ? (
                  <div className="empty-state">
                    <p>Your generated images will appear here.</p>
                  </div>
                ) : (
                  <section className="studio-grid">
                    {studioItems.map((item) => (
                      <article key={item.id} className="studio-card">
                        <img src={item.dataUrl} alt={item.prompt} className="studio-image" loading="lazy" />
                        <div className="studio-meta">
                          <p className="card-text">{item.prompt}</p>
                          <p className="card-meta">
                            {new Date(item.createdAt).toLocaleString()} - {item.latencyMs} ms
                          </p>
                          {item.note ? <p className="card-muted">{item.note}</p> : null}
                        </div>
                        <div className="studio-actions">
                          <a
                            className="ghost-btn"
                            href={item.dataUrl}
                            download={`aries-${item.id}.${item.mimeType.includes("png") ? "png" : "jpg"}`}
                          >
                            Download
                          </a>
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => {
                              dispatch({ type: "setInput", value: `Use this image idea: ${item.prompt}` });
                              setPanel("chat");
                            }}
                          >
                            Use Prompt in Chat
                          </button>
                        </div>
                      </article>
                    ))}
                  </section>
                )}
              </div>
            </section>
          ) : null}

          {panel === "code" ? (
            <section className="panel-view">
              <header className="chat-header">
                <h2>Code Lab</h2>
                <p>Generate implementation-ready code, test ideas, and developer resources in one workspace.</p>
              </header>

              <div className="chat-thread">
                <section className="code-terms">
                  <h3>Code Lab Terms of Use</h3>
                  <ul>
                    {CODE_LAB_TERMS.map((term) => (
                      <li key={term}>{term}</li>
                    ))}
                  </ul>
                </section>

                <section className="code-form-card">
                  <form className="code-form" onSubmit={handleGenerateCodeIdea}>
                    <div className="code-controls">
                      <label>
                        Language
                        <select
                          value={codeLanguage}
                          onChange={(event) => setCodeLanguage(event.target.value as (typeof CODE_LANGUAGES)[number])}
                          disabled={codeBusy}
                        >
                          {CODE_LANGUAGES.map((language) => (
                            <option key={language} value={language}>
                              {language}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Framework / Stack (optional)
                        <input
                          value={codeFramework}
                          onChange={(event) => setCodeFramework(event.target.value)}
                          placeholder="React, FastAPI, Node, Django..."
                          disabled={codeBusy}
                        />
                      </label>
                    </div>

                    <label>
                      What do you want to build?
                      <textarea
                        className="composer"
                        rows={5}
                        placeholder="Describe the feature, constraints, and desired output..."
                        value={codePrompt}
                        onChange={(event) => setCodePrompt(event.target.value)}
                        disabled={codeBusy}
                      />
                    </label>

                    <div className="code-actions">
                      <button type="submit" className="primary-btn" disabled={codeBusy || !codePrompt.trim()}>
                        {codeBusy ? "Generating..." : "Generate Code"}
                      </button>
                    </div>
                  </form>
                </section>

                {codeError ? <div className="global-error">{codeError}</div> : null}

                {codeItems.length === 0 ? (
                  <div className="empty-state">
                    <p>Your code ideas and generated outputs will appear here.</p>
                  </div>
                ) : (
                  <section className="code-results">
                    {codeItems.map((item) => (
                      <article key={item.id} className="code-card">
                        <header className="code-card-header">
                          <div>
                            <p className="model-badge">
                              {item.language}
                              {item.framework ? ` · ${item.framework}` : ""}
                            </p>
                            <p className="card-meta">
                              {new Date(item.createdAt).toLocaleString()}
                              {item.latencyMs ? ` · ${item.latencyMs} ms` : ""}
                            </p>
                          </div>
                          <button type="button" className="ghost-btn" onClick={() => void handleCopyCodeResult(item.responseText)}>
                            Copy
                          </button>
                        </header>
                        <div className="code-card-body">
                          <p className="code-request">{item.prompt}</p>
                          <RichContent text={item.responseText} className="card-text" />
                          {item.blocked ? (
                            <div className="guardrail-note">
                              <strong>Safety block:</strong> this request was flagged and reported for review.
                              {showDiagnosticDetails && item.reportId ? ` Report ID: ${item.reportId}` : ""}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </section>
                )}
              </div>
            </section>
          ) : null}

          {panel === "terms" ? (
            <section className="panel-view">
              <header className="chat-header">
                <h2>Terms of Use</h2>
                <p>Includes reporting policy and role access-key rules.</p>
              </header>
              <div className="chat-thread">
                {!terms && legalBusy ? <p className="card-muted">Loading terms...</p> : null}
                {!terms && !legalBusy ? (
                  <button type="button" className="primary-btn" onClick={() => void loadTermsAndGuidelines()}>
                    Load Terms
                  </button>
                ) : null}
                {terms ? (
                  <div className="legal-pane">
                    <h3>{terms.title}</h3>
                    <p className="message-time">
                      Version {terms.version} - Updated {terms.updatedAt}
                    </p>
                    {terms.content.map((line, index) => (
                      <p key={`terms-panel-${index}`} className="card-muted">
                        {line}
                      </p>
                    ))}
                  </div>
                ) : null}
                {legalError ? <div className="global-error">{legalError}</div> : null}
              </div>
            </section>
          ) : null}

          {panel === "guidelines" ? (
            <section className="panel-view">
              <header className="chat-header">
                <h2>AI Guidelines & Guardrails</h2>
                <p>These controls are enforced before model execution.</p>
              </header>
              <div className="chat-thread">
                {!guidelines && legalBusy ? <p className="card-muted">Loading guidelines...</p> : null}
                {!guidelines && !legalBusy ? (
                  <button type="button" className="primary-btn" onClick={() => void loadTermsAndGuidelines()}>
                    Load Guidelines
                  </button>
                ) : null}
                {guidelines
                  ? guidelines.sections.map((section) => (
                      <div key={section.title} className="legal-section">
                        <h3>{section.title}</h3>
                        <ul>
                          {section.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ))
                  : null}
                {legalError ? <div className="global-error">{legalError}</div> : null}
              </div>
            </section>
          ) : null}

          {panel === "admin" ? (
            <section className="panel-view">
              <header className="chat-header">
                <h2>Role Console</h2>
                <p>Permissions, reports, account management, access keys, and founder terminal controls.</p>
              </header>

              <div className="chat-thread">
                {adminBusy ? <p className="card-muted">Loading admin data...</p> : null}
                {adminError ? <div className="global-error">{adminError}</div> : null}

                {permissions ? (
                  <section className="admin-card">
                    <h3>Role Permissions ({permissions.role})</h3>
                    <p className="card-meta">Allowed actions:</p>
                    <div className="mono-block">{permissions.allowed.join("\n") || "none"}</div>
                    <p className="card-meta">Denied actions:</p>
                    <div className="mono-block">{permissions.denied.join("\n") || "none"}</div>
                  </section>
                ) : null}

                {hasPerm("reports:view") ? (
                  <section className="admin-card">
                    <h3>Safety Reports</h3>
                    {reports.length === 0 ? <p className="card-muted">No reports yet.</p> : null}
                    {reports.map((report) => (
                      <article key={report.id} className="report-item">
                        <p className="message-label">
                          {report.category} - {report.status}
                        </p>
                        <p className="message-time">{new Date(report.createdAt).toLocaleString()}</p>
                        <p className="card-text">{report.message}</p>
                        <p className="card-meta">User: {report.userEmail ?? "unknown"}</p>
                        <p className="card-meta">Matched: {report.matched.join(", ") || "none"}</p>
                        {hasPerm("reports:manage") ? (
                          <div className="report-actions">
                            <button
                              type="button"
                              className="ghost-btn"
                              onClick={() => void handleReportStatusChange(report.id, "reviewed")}
                            >
                              Mark Reviewed
                            </button>
                            <button
                              type="button"
                              className="ghost-btn"
                              onClick={() => void handleReportStatusChange(report.id, "closed")}
                            >
                              Close
                            </button>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </section>
                ) : null}

                {hasPerm("users:view") ? (
                  <section className="admin-card">
                    <h3>Accounts</h3>
                    {creatableRoles.length > 0 ? (
                      <form className="auth-form" onSubmit={handleCreateUser}>
                        <label>
                          Email
                          <input
                            value={newUserEmail}
                            onChange={(event) => setNewUserEmail(event.target.value)}
                            type="email"
                            required
                          />
                        </label>

                        <label>
                          Password
                          <input
                            value={newUserPassword}
                            onChange={(event) => setNewUserPassword(event.target.value)}
                            type="password"
                            required
                          />
                        </label>

                        <label>
                          Role
                          <select
                            value={newUserRole}
                            onChange={(event) => setNewUserRole(event.target.value as Exclude<UserRole, "founder">)}
                          >
                            {creatableRoles.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                        </label>

                        <button type="submit" className="primary-btn">
                          Create Account
                        </button>
                      </form>
                    ) : (
                      <p className="card-muted">This role cannot create new accounts.</p>
                    )}

                    <h3>Existing Users</h3>
                    <div className="user-list">
                      {users.map((user) => (
                        <div key={user.id} className="user-item">
                          <p>{user.email}</p>
                          <small>
                            {user.role} - {new Date(user.createdAt).toLocaleDateString()}
                          </small>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {hasPerm("users:view") ? (
                  <section className="admin-card">
                    <h3>Account Audit (Recent)</h3>
                    {accountAudit.length === 0 ? <p className="card-muted">No account audit events yet.</p> : null}
                    <div className="user-list">
                      {accountAudit.slice(0, 18).map((entry) => (
                        <div key={entry.id} className="user-item">
                          <p>{entry.action}</p>
                          <small>{new Date(entry.createdAt).toLocaleString()}</small>
                          <small>
                            Actor: {entry.actorEmail ?? "unknown"}
                            {entry.targetEmail ? ` -> Target: ${entry.targetEmail}` : ""}
                          </small>
                          {entry.ip ? <small>IP: {entry.ip}</small> : null}
                          {entry.note ? <small>Note: {entry.note}</small> : null}
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {hasPerm("users:view") ? (
                  <section className="admin-card">
                    <h3>Banned IP Watchlist</h3>
                    {bannedIps.length === 0 ? <p className="card-muted">No banned IPs.</p> : null}
                    <div className="user-list">
                      {bannedIps.slice(0, 18).map((entry) => (
                        <div key={`${entry.ip}-${entry.bannedAt}`} className="user-item">
                          <p>{entry.ip}</p>
                          <small>Banned: {new Date(entry.bannedAt).toLocaleString()}</small>
                          <small>Reason: {entry.reason}</small>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {hasPerm("apikeys:view:own") || hasPerm("apikeys:view:any") ? (
                  <section className="admin-card">
                    <h3>Integration Access Keys</h3>
                    <p className="card-muted">Create scoped integration credentials for connected Aries projects.</p>

                    {(hasPerm("apikeys:create:own") || hasPerm("apikeys:create:any")) ? (
                      <form className="auth-form" onSubmit={handleCreateApiKey}>
                        <label>
                          Key Label
                          <input
                            value={apiKeyLabel}
                            onChange={(event) => setApiKeyLabel(event.target.value)}
                            required
                          />
                        </label>

                        {hasPerm("apikeys:create:any") ? (
                          <label>
                            Owner Email (optional)
                            <input
                              value={apiKeyOwnerEmail}
                              onChange={(event) => setApiKeyOwnerEmail(event.target.value)}
                              placeholder="leave blank for your account"
                            />
                          </label>
                        ) : null}

                        <button type="submit" className="primary-btn">
                          Generate Access Key
                        </button>
                      </form>
                    ) : null}

                    {createdApiKey ? (
                      <div className="global-error">
                        <strong>Copy now:</strong> {createdApiKey}
                      </div>
                    ) : null}

                    <div className="user-list">
                      {apiKeys.map((key) => (
                        <div key={key.id} className="user-item">
                          <p>{key.label}</p>
                          <small>{key.keyPrefix}*** - owner: {key.ownerEmail}</small>
                          <small>
                            Created {new Date(key.createdAt).toLocaleString()}
                            {key.lastUsedAt ? ` - Last used ${new Date(key.lastUsedAt).toLocaleString()}` : ""}
                            {key.revokedAt ? ` - Revoked ${new Date(key.revokedAt).toLocaleString()}` : ""}
                          </small>
                          {!key.revokedAt ? (
                            <button
                              type="button"
                              className="ghost-btn"
                              onClick={() => void handleRevokeApiKey(key.id)}
                            >
                              Revoke
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {(hasPerm("apikeys:view:own") || hasPerm("apikeys:view:any")) ? (
                  <section className="admin-card">
                    <h3>Embed Aries Assistant</h3>
                    <p className="card-muted">
                      Use an admin/staff integration key to link Aries to your other website as a helper chatbot.
                    </p>
                    <pre className="mono-block">
{`curl -s -X POST http://localhost:3000/api/external/chat/dual \\
  -H "Content-Type: application/json" \\
  -H "x-aries-api-key: YOUR_ADMIN_OR_STAFF_KEY" \\
  -d '{"sessionId":"external-session","message":"Hello from my site","history":[]}'`}
                    </pre>
                    <button type="button" className="ghost-btn" onClick={() => void handleCopyEmbedSnippet()}>
                      Copy Integration Snippet
                    </button>
                  </section>
                ) : null}

                {hasPerm("terminal:execute") ? (
                  <section className="admin-card">
                    <h3>Founder Terminal</h3>
                    <p className="card-muted">Founder-only command runner with server-side prefix restrictions.</p>
                    <form className="auth-form" onSubmit={handleRunTerminal}>
                      <label>
                        Command
                        <input
                          value={terminalCommand}
                          onChange={(event) => setTerminalCommand(event.target.value)}
                          required
                        />
                      </label>

                      <button type="submit" className="primary-btn" disabled={terminalBusy}>
                        {terminalBusy ? "Running..." : "Run Command"}
                      </button>
                    </form>

                    {terminalOutput ? <pre className="terminal-output">{terminalOutput}</pre> : null}
                  </section>
                ) : null}
              </div>
            </section>
          ) : null}
        </main>
      </div>
      {undoNotice ? (
        <div className="undo-toast" role="status" aria-live="polite">
          <p>{undoNotice.label}</p>
          <button type="button" className="ghost-btn" onClick={handleUndo}>
            Undo
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default App;
