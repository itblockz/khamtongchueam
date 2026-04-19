import {
  type Key,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ComboBox,
  ComboBoxStateContext,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
} from "react-aria-components";
import { Settings, ChevronRight, X, HelpCircle } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { indentLess, indentMore } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import "./App.css";
import {
  acknowledgeRoundSummary,
  beginChallengeSelection,
  cancelChallenge,
  CHALLENGE_DEBATE_SEGMENT_COUNT,
  CHALLENGE_DEBATE_SEGMENT_DURATION_MS,
  TURN_DURATION_MS,
  applyScoreAwards,
  advanceChallengeDebate,
  advanceTurn,
  applyInputChange,
  createConfirmedGameState,
  createInitialDrafts,
  createPlayerDraft,
  createSetupState,
  getChallengeableAnswers,
  getScoreAwards,
  prepareRoster,
  resolveChallenge,
  resumeChallengeDebate,
  startRoundWithOpeningWord,
  startActiveTurn,
  startChallengeDebate,
  hostEliminateCurrentPlayer,
  pauseGameStateForHistoryRestore,
  tickChallengeDebate,
  resumePausedChallengeFromHistory,
  resumePausedTurnFromHistory,
  updateChallengeSelection,
  type AnswerRecord,
  type GameState,
  type LeaderboardAward,
  type PlayerDraft,
  type TurnDirection,
} from "./game";
import {
  DEFAULT_SYLLABLE_ENGINE,
  SyllableSegmentationError,
  type SyllableSegmentationResponse,
  segmentThaiText,
} from "./syllableClient";
import { useTurnTimer } from "./useTurnTimer";
import { useUndoRedoHistory } from "./useUndoRedoHistory";

function moveLineUp(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  if (line.number === 1) {
    return true;
  }
  const prevLine = state.doc.line(line.number - 1);
  const text = line.text;
  view.dispatch({
    changes: [
      { from: line.from, to: line.to, insert: prevLine.text },
      { from: prevLine.from, to: prevLine.to, insert: text },
    ],
    selection: { anchor: prevLine.from, head: prevLine.to },
  });
  return true;
}

function moveLineDown(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const nextLine = state.doc.line(line.number + 1);
  if (!nextLine) {
    return true;
  }
  const text = line.text;
  view.dispatch({
    changes: [
      { from: line.from, to: line.to, insert: nextLine.text },
      { from: nextLine.from, to: nextLine.to, insert: text },
    ],
    selection: {
      anchor: nextLine.from,
      head: nextLine.to,
    },
  });
  return true;
}

function duplicateLineUp(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  view.dispatch({
    changes: { from: line.from, to: line.from, insert: line.text + "\n" },
    selection: { anchor: line.from, head: line.from },
  });
  return true;
}

function duplicateLineDown(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const insertPos = line.to;
  view.dispatch({
    changes: { from: insertPos, to: insertPos, insert: "\n" + line.text },
    selection: { anchor: insertPos + 1, head: insertPos + 1 },
  });
  return true;
}

function exitEditor(): boolean {
  const confirmButton = document.querySelector(
    ".start-button",
  ) as HTMLButtonElement | null;
  confirmButton?.focus();
  return true;
}

const MATCH_ROUNDS_PER_MATCH = 4;
const SYLLABLE_REQUEST_DEBOUNCE_MS = 250;
const SYLLABLE_DEBUG_STORAGE_KEY = "khamtongchueam:show-syllable-debug";
const GM_OPENING_WORD_STORAGE_KEY = "khamtongchueam:gm-opening-word-enabled";
const FOCUS_SIDEBAR_OPEN_KEY = "khamtongchueam:focus-sidebar-open";

function getTurnDirectionForMatchRound(matchRound: number): TurnDirection {
  return matchRound % 2 === 1 ? 1 : -1;
}

function formatSeconds(timeLeftMs: number) {
  return (timeLeftMs / 1000).toFixed(1);
}

function normalizeChallengeTypeaheadText(text: string) {
  return text.trim().toLocaleLowerCase();
}

function matchesChallengeTypeaheadCandidate(text: string, query: string) {
  const normalizedQuery = normalizeChallengeTypeaheadText(query);

  if (normalizedQuery.length === 0) {
    return true;
  }

  return normalizeChallengeTypeaheadText(text).startsWith(normalizedQuery);
}

function getMatchingChallengeChallengerOptions(
  options: ChallengeChallengerOption[],
  query: string,
) {
  return options.filter((player) =>
    matchesChallengeTypeaheadCandidate(player.name, query),
  );
}

function getInitialSyllableDebugVisibility() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(SYLLABLE_DEBUG_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getInitialGmOpeningWordEnabled() {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    return window.localStorage.getItem(GM_OPENING_WORD_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function getInitialFocusSidebarOpen() {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    return window.localStorage.getItem(FOCUS_SIDEBAR_OPEN_KEY) !== "false";
  } catch {
    return true;
  }
}

function getEliminatedPlayerSummary(
  player: GameState["players"][number] | null,
) {
  if (!player) {
    return "มีผู้เล่นตกรอบในรอบนี้";
  }

  if (player.eliminationReason === "duplicate_syllable") {
    if (player.duplicateSubmittedAnswer && player.duplicateSourceAnswer) {
      return `${player.name} ตกรอบเพราะคำตอบ "${player.duplicateSubmittedAnswer}" ซ้ำกับคำ "${player.duplicateSourceAnswer}"`;
    }

    if (player.duplicateSourceAnswer) {
      return `${player.name} ตกรอบเพราะคำตอบซ้ำกับคำ "${player.duplicateSourceAnswer}"`;
    }

    return `${player.name} ตกรอบเพราะใช้พยางค์ซ้ำ`;
  }

  if (player.eliminationReason === "late_submit") {
    return `${player.name} ตกรอบเพราะส่งคำช้าเกินเวลา`;
  }

  if (player.eliminationReason === "timeout") {
    return `${player.name} ตกรอบเพราะไม่ทันเวลา`;
  }

  if (player.eliminationReason === "failed_challenge") {
    if (player.challengeTargetAnswer) {
      return `${player.name} ตกรอบเพราะชาเลนจ์คำ "${player.challengeTargetAnswer}" ไม่สำเร็จ`;
    }

    return `${player.name} ตกรอบเพราะชาเลนจ์ไม่สำเร็จ`;
  }

  if (player.eliminationReason === "invalid_connection") {
    if (player.challengeTargetAnswer && player.challengeSourceAnswer) {
      return `${player.name} ตกรอบเพราะคำ "${player.challengeTargetAnswer}" ไม่เชื่อมกับคำ "${player.challengeSourceAnswer}"`;
    }

    return `${player.name} ตกรอบเพราะคำไม่เชื่อมกัน`;
  }

  if (player.eliminationReason === "not_noun") {
    if (player.duplicateSubmittedAnswer) {
      return `${player.name} ตกรอบเพราะ "${player.duplicateSubmittedAnswer}" ไม่ใช่คำนาม`;
    }
    return `${player.name} ตกรอบเพราะไม่ใช่คำนาม`;
  }

  return `${player.name} ตกรอบ`;
}

function getPausedTurnReasonText(player: GameState["players"][number] | null) {
  return getEliminatedPlayerSummary(player);
}

function getPausedTurnInstructions(
  player: GameState["players"][number] | null,
  activePlayerName: string,
) {
  return `ยังไม่เริ่มจับเวลา ${getPausedTurnReasonText(
    player,
  )} กดเริ่มเพื่อเริ่มจับเวลาของ ${activePlayerName}`;
}

function getDuplicateSyllableDetails(
  player: GameState["players"][number] | null,
) {
  if (
    !player ||
    player.eliminationReason !== "duplicate_syllable" ||
    !player.duplicateSyllable ||
    !player.duplicateSourceAnswer ||
    !player.duplicateSubmittedAnswer
  ) {
    return null;
  }

  return {
    duplicateSyllable: player.duplicateSyllable,
    sourceAnswer: player.duplicateSourceAnswer,
    submittedAnswer: player.duplicateSubmittedAnswer,
  };
}

function renderHighlightedAnswer(answer: string, syllable: string) {
  if (!syllable || !answer.includes(syllable)) {
    return <span className="duplicate-answer-text">{answer}</span>;
  }

  const parts: ReactNode[] = [];
  const segments = answer.split(syllable);

  segments.forEach((segment, index) => {
    if (segment) {
      parts.push(<span key={`segment-${index}`}>{segment}</span>);
    }

    if (index < segments.length - 1) {
      parts.push(
        <mark className="duplicate-syllable-mark" key={`match-${index}`}>
          {syllable}
        </mark>,
      );
    }
  });

  return <span className="duplicate-answer-text">{parts}</span>;
}

function renderEliminatedPlayerSummaryContent(
  player: GameState["players"][number] | null,
) {
  const duplicateDetails = getDuplicateSyllableDetails(player);

  if (player && duplicateDetails) {
    return (
      <>
        <span>{player.name} ตกรอบเพราะคำตอบ "</span>
        {renderHighlightedAnswer(
          duplicateDetails.submittedAnswer,
          duplicateDetails.duplicateSyllable,
        )}
        <span>" ซ้ำกับคำ "</span>
        {renderHighlightedAnswer(
          duplicateDetails.sourceAnswer,
          duplicateDetails.duplicateSyllable,
        )}
        <span>"</span>
      </>
    );
  }

  return getEliminatedPlayerSummary(player);
}

function getSegmentationCacheKey(text: string) {
  return `${DEFAULT_SYLLABLE_ENGINE}::${text.trim()}`;
}

function getSegmentationErrorMessage(error: unknown) {
  if (error instanceof SyllableSegmentationError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "ไม่สามารถเชื่อมต่อระบบแยกพยางค์ได้";
}

function isBlankDraft(draft: PlayerDraft) {
  return draft.name.trim().length === 0;
}

function ensureTrailingBlankDraft(playerDrafts: PlayerDraft[]) {
  if (playerDrafts.length === 0) {
    return [createPlayerDraft()];
  }

  const nextDrafts = [...playerDrafts];

  while (
    nextDrafts.length > 1 &&
    isBlankDraft(nextDrafts[nextDrafts.length - 1]) &&
    isBlankDraft(nextDrafts[nextDrafts.length - 2])
  ) {
    nextDrafts.pop();
  }

  if (!isBlankDraft(nextDrafts[nextDrafts.length - 1])) {
    nextDrafts.push(createPlayerDraft());
  }

  return nextDrafts;
}

interface SessionState {
  gameState: GameState;
  leaderboardScores: Record<string, number>;
  roundScoreBreakdownsInMatch: Array<Record<string, RoundScoreBreakdown>>;
  completedRoundsInMatch: number;
}

interface HistoryUiState {
  gmOpeningWordDraft: string;
}

interface HistorySnapshot {
  sessionState: SessionState;
  uiState: HistoryUiState;
}

interface RoundScoreBreakdown {
  totalPoints: number;
  challengeBonus: number;
}

type ChallengeChallengerOption = GameState["players"][number];

function createInitialHistoryUiState(): HistoryUiState {
  return {
    gmOpeningWordDraft: "",
  };
}

function createInitialHistorySnapshot(): HistorySnapshot {
  return {
    sessionState: createInitialSessionState(),
    uiState: createInitialHistoryUiState(),
  };
}

interface ChallengeChallengerListBoxProps {
  activeSuggestionId: string | null;
  options: ChallengeChallengerOption[];
}

function ChallengeChallengerListBox({
  activeSuggestionId,
  options,
}: ChallengeChallengerListBoxProps) {
  const comboBoxState = useContext(ComboBoxStateContext);
  const selectionManager = comboBoxState?.selectionManager ?? null;
  const isOpen = comboBoxState?.isOpen ?? false;

  useLayoutEffect(() => {
    if (!selectionManager || !isOpen) {
      return;
    }

    selectionManager.setFocusedKey(activeSuggestionId);
  }, [activeSuggestionId, isOpen, selectionManager]);

  return (
    <ListBox
      className="challenge-challenger-listbox"
      items={options}
      renderEmptyState={() => (
        <div className="challenge-challenger-empty" role="status">
          ไม่พบผู้ชาเลนจ์ที่ตรงกัน
        </div>
      )}
    >
      {(player: ChallengeChallengerOption) => (
        <ListBoxItem
          id={player.id}
          className={({ isFocused, isSelected }) =>
            [
              "challenge-challenger-option",
              isFocused ? "is-focused" : "",
              isSelected ? "is-selected" : "",
            ]
              .filter(Boolean)
              .join(" ")
          }
          textValue={player.name}
        >
          {player.name}
        </ListBoxItem>
      )}
    </ListBox>
  );
}

interface SettingsDropdownProps {
  isGmOpeningEnabled: boolean;
  isSyllableDebugVisible: boolean;
  onToggleGmOpening: () => void;
  onToggleSyllableDebug: () => void;
  isSubmittingTurn: boolean;
}

function SettingsDropdown({
  isGmOpeningEnabled,
  isSyllableDebugVisible,
  onToggleGmOpening,
  onToggleSyllableDebug,
  isSubmittingTurn,
}: SettingsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeIfFocusLeftDropdown = useCallback(() => {
    const activeElement = document.activeElement;

    if (
      activeElement instanceof Node &&
      (menuRef.current?.contains(activeElement) ||
        buttonRef.current?.contains(activeElement))
    ) {
      return;
    }

    setIsOpen(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div className="settings-dropdown">
      <button
        ref={buttonRef}
        type="button"
        className="ghost-button settings-dropdown-trigger"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="ตั้งค่าเกม"
        title="ตั้งค่าเกม"
      >
        <Settings size={18} aria-hidden="true" />
      </button>
      {isOpen && (
        <div
          ref={menuRef}
          className="settings-dropdown-menu surface-card"
          role="menu"
          onKeyDown={handleKeyDown}
          onBlur={(e) => {
            const nextTarget = e.relatedTarget;

            if (
              nextTarget instanceof Node &&
              (menuRef.current?.contains(nextTarget) ||
                buttonRef.current?.contains(nextTarget))
            ) {
              return;
            }

            window.setTimeout(closeIfFocusLeftDropdown, 0);
          }}
        >
          <button
            type="button"
            className="settings-dropdown-item"
            onClick={(e) => {
              e.currentTarget.focus();
              onToggleGmOpening();
            }}
            disabled={isSubmittingTurn}
            aria-pressed={isGmOpeningEnabled}
          >
            <span className="settings-dropdown-item-check" aria-hidden="true">
              {isGmOpeningEnabled ? "✓" : ""}
            </span>
            ผู้คุมเกมเริ่ม
          </button>
          <button
            type="button"
            className="settings-dropdown-item"
            onClick={(e) => {
              e.currentTarget.focus();
              onToggleSyllableDebug();
            }}
            aria-pressed={isSyllableDebugVisible}
          >
            <span className="settings-dropdown-item-check" aria-hidden="true">
              {isSyllableDebugVisible ? "✓" : ""}
            </span>
            <span>ดีบักพยางค์</span>
          </button>
        </div>
      )}
    </div>
  );
}

function createInitialSessionState(): SessionState {
  return {
    gameState: createSetupState(),
    leaderboardScores: {},
    roundScoreBreakdownsInMatch: [],
    completedRoundsInMatch: 0,
  };
}

function createRoundScoreBreakdownMap(
  awards: LeaderboardAward[],
): Record<string, RoundScoreBreakdown> {
  return awards.reduce<Record<string, RoundScoreBreakdown>>(
    (scoreMap, award) => ({
      ...scoreMap,
      [award.playerId]: {
        totalPoints: award.points,
        challengeBonus: award.challengeBonus,
      },
    }),
    {},
  );
}

function applyFinishedSessionState(
  currentSession: SessionState,
  nextGameState: GameState,
): SessionState {
  if (
    currentSession.gameState.phase === "finished" ||
    nextGameState.phase !== "finished"
  ) {
    return {
      ...currentSession,
      gameState: nextGameState,
    };
  }

  const roundAwards = getScoreAwards(nextGameState);

  return {
    gameState: nextGameState,
    leaderboardScores: applyScoreAwards(
      currentSession.leaderboardScores,
      roundAwards,
    ),
    roundScoreBreakdownsInMatch: [
      ...currentSession.roundScoreBreakdownsInMatch,
      createRoundScoreBreakdownMap(roundAwards),
    ],
    completedRoundsInMatch: Math.min(
      currentSession.completedRoundsInMatch + 1,
      MATCH_ROUNDS_PER_MATCH,
    ),
  };
}

function App() {
  const [playerDrafts, setPlayerDrafts] = useState<PlayerDraft[]>(() =>
    ensureTrailingBlankDraft(createInitialDrafts()),
  );
  const {
    historyState,
    present: historySnapshot,
    canUndo,
    canRedo,
    resetHistory,
    updatePresent,
    commitPresent,
    undoPresent,
    redoPresent,
  } = useUndoRedoHistory(createInitialHistorySnapshot());
  const answerInputRef = useRef<HTMLInputElement>(null);
  const startFirstTurnButtonRef = useRef<HTMLButtonElement>(null);
  const leaderboardActionButtonRef = useRef<HTMLButtonElement>(null);
  const challengeChallengerInputRef = useRef<HTMLInputElement>(null);
  const challengeChallengedAnswerSelectRef = useRef<HTMLSelectElement>(null);
  const challengeDecisionButtonRef = useRef<HTMLButtonElement>(null);
  const challengeResumeButtonRef = useRef<HTMLButtonElement>(null);
  const challengeHistoryRestorePauseRef = useRef(false);
  const segmentationCacheRef = useRef<
    Map<string, SyllableSegmentationResponse>
  >(new Map());
  const [currentInputSegmentation, setCurrentInputSegmentation] =
    useState<SyllableSegmentationResponse | null>(null);
  const [segmentationError, setSegmentationError] = useState<string | null>(
    null,
  );
  const [isSegmentingCurrentInput, setIsSegmentingCurrentInput] =
    useState(false);
  const [isSubmittingTurn, setIsSubmittingTurn] = useState(false);
  const [challengeChallengerSearchValue, setChallengeChallengerSearchValue] =
    useState("");
  const [
    challengeChallengerActiveOptionId,
    setChallengeChallengerActiveOptionId,
  ] = useState<string | null>(null);
  const [isGmOpeningWordEnabled, setIsGmOpeningWordEnabled] = useState(() =>
    getInitialGmOpeningWordEnabled(),
  );
  const [isSyllableDebugVisible, setIsSyllableDebugVisible] = useState(() =>
    getInitialSyllableDebugVisibility(),
  );
  const [isFocusSidebarOpen, setIsFocusSidebarOpen] = useState(() =>
    getInitialFocusSidebarOpen(),
  );
  const [playerNamesTextarea, setPlayerNamesTextarea] = useState(() =>
    createInitialDrafts()
      .map((d) => d.name)
      .filter((n) => n)
      .join("\n"),
  );
  const playerEditorExtensions: Extension[] = [
    EditorView.lineWrapping,
    keymap.of([
      {
        key: "Alt-ArrowUp",
        run: (view) => {
          moveLineUp(view);
          return true;
        },
      },
      {
        key: "Alt-ArrowDown",
        run: (view) => {
          moveLineDown(view);
          return true;
        },
      },
      {
        key: "Shift-Alt-ArrowUp",
        run: (view) => {
          duplicateLineUp(view);
          return true;
        },
      },
      {
        key: "Shift-Alt-ArrowDown",
        run: (view) => {
          duplicateLineDown(view);
          return true;
        },
      },
      {
        key: "Tab",
        run: (view) => {
          indentMore(view);
          return true;
        },
      },
      {
        key: "Shift-Tab",
        run: (view) => {
          indentLess(view);
          return true;
        },
      },
      {
        key: "Escape",
        run: () => exitEditor(),
      },
    ]),
  ];
  const { sessionState, uiState } = historySnapshot;
  const gmOpeningWordDraft = uiState.gmOpeningWordDraft;
  const { gameState, leaderboardScores, roundScoreBreakdownsInMatch } =
    sessionState;
  const currentMatchRound =
    gameState.phase === "finished"
      ? Math.max(sessionState.completedRoundsInMatch, 1)
      : Math.min(
        sessionState.completedRoundsInMatch + 1,
        MATCH_ROUNDS_PER_MATCH,
      );
  const isMatchComplete =
    sessionState.completedRoundsInMatch >= MATCH_ROUNDS_PER_MATCH;
  const replayButtonLabel = isMatchComplete
    ? "เริ่มแมตช์ใหม่ด้วยรายชื่อเดิม"
    : "เล่นรอบถัดไปด้วยรายชื่อเดิม";
  const replayButtonCopy = isMatchComplete ? "แมตช์ใหม่" : "รอบถัดไป";

  const playerNamesFromTextarea = playerNamesTextarea
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const validation = {
    canStart: playerNamesFromTextarea.length >= 2,
    playerCount: playerNamesFromTextarea.length,
    hasDuplicates: false,
  };
  const playerById = new Map(
    gameState.players.map((player) => [player.id, player]),
  );
  const activePlayer =
    gameState.players.find(
      (player) => player.id === gameState.activePlayerId,
    ) ?? null;
  const winner =
    gameState.players.find((player) => player.id === gameState.winnerId) ??
    null;
  const isAwaitingRoundSummary =
    gameState.phase === "finished" &&
    gameState.isAwaitingRoundSummary &&
    winner !== null;
  const playScreenPlayer =
    gameState.phase === "playing"
      ? activePlayer
      : isAwaitingRoundSummary
        ? winner
        : null;
  const activePlayers = gameState.players.filter(
    (player) => player.status === "active",
  );
  const answerRecordById = new Map(
    gameState.answerHistory.map((answerRecord) => [
      answerRecord.id,
      answerRecord,
    ]),
  );
  const lastAnswer = (() => {
    for (let i = gameState.answerHistory.length - 1; i >= 0; i--) {
      const record = gameState.answerHistory[i];
      if (!record.invalidatedByChallenge || record.challengeResolved) {
        return record.answer;
      }
    }
    return null;
  })();
  const challengeableAnswers =
    gameState.phase === "playing" ? getChallengeableAnswers(gameState) : [];
  const challengeState =
    gameState.phase === "playing" ? gameState.challenge : null;
  const isChallengeSelecting = challengeState?.status === "selecting";
  const isChallengeDebating = challengeState?.status === "debating";
  const isChallengeJudging = challengeState?.status === "judging";
  const isChallengeActive =
    gameState.phase === "playing" && challengeState?.status !== "idle";
  const selectedChallengedAnswer = challengeState?.challengedAnswerId
    ? (answerRecordById.get(challengeState.challengedAnswerId) ?? null)
    : null;
  const selectedChallengePreviousAnswer = challengeState?.previousValidAnswerId
    ? (answerRecordById.get(challengeState.previousValidAnswerId) ?? null)
    : null;
  const selectedChallenger = challengeState?.challengerPlayerId
    ? (playerById.get(challengeState.challengerPlayerId) ?? null)
    : null;
  const selectedChallengedPlayer = challengeState?.challengedPlayerId
    ? (playerById.get(challengeState.challengedPlayerId) ?? null)
    : null;
  const challengeChallengerOptions = activePlayers.filter(
    (player) => player.id !== selectedChallengedPlayer?.id,
  );
  const normalizedChallengeChallengerSearch = normalizeChallengeTypeaheadText(
    challengeChallengerSearchValue,
  );
  const filteredChallengeChallengerOptions =
    getMatchingChallengeChallengerOptions(
      challengeChallengerOptions,
      normalizedChallengeChallengerSearch,
    );
  const preferredChallengeChallengerId =
    challengeChallengerActiveOptionId ??
    selectedChallenger?.id ??
    (normalizedChallengeChallengerSearch.length > 0
      ? (filteredChallengeChallengerOptions[0]?.id ?? null)
      : null);
  const canOpenChallenge =
    gameState.phase === "playing" &&
    challengeState?.status === "idle" &&
    activePlayers.length > 1 &&
    challengeableAnswers.length > 0 &&
    !isSubmittingTurn;
  const canStartVisibleChallenge =
    isChallengeSelecting &&
    preferredChallengeChallengerId !== null &&
    selectedChallengedAnswer !== null &&
    selectedChallengePreviousAnswer !== null;
  const visiblePlayers =
    isAwaitingRoundSummary && winner !== null ? [winner] : activePlayers;

  const displayedActivePlayerId = isChallengeActive
    ? null
    : gameState.activePlayerId;
  const eliminatedPlayers = gameState.players.filter(
    (player) => player.status === "eliminated",
  );
  const latestEliminatedPlayer =
    eliminatedPlayers.length > 0
      ? [...eliminatedPlayers].sort(
        (left, right) =>
          (right.eliminatedOrder ?? 0) - (left.eliminatedOrder ?? 0),
      )[0]
      : null;
  const eliminatedPlayerSummary = getEliminatedPlayerSummary(
    latestEliminatedPlayer,
  );
  const eliminatedPlayerSummaryContent = renderEliminatedPlayerSummaryContent(
    latestEliminatedPlayer,
  );
  const roundAwards =
    gameState.phase === "finished" ? getScoreAwards(gameState) : [];
  const roundAwardMap = new Map(
    roundAwards.map((award) => [award.playerId, award]),
  );
  const leaderboardEntries =
    gameState.phase === "finished"
      ? gameState.players
        .map((player, index) => ({
          player,
          score: leaderboardScores[player.id] ?? 0,
          roundScores: Array.from(
            { length: MATCH_ROUNDS_PER_MATCH },
            (_, roundIndex) => {
              if (roundIndex >= sessionState.completedRoundsInMatch) {
                return null;
              }

              return (
                roundScoreBreakdownsInMatch[roundIndex]?.[player.id] ?? {
                  totalPoints: 0,
                  challengeBonus: 0,
                }
              );
            },
          ),
          roundPoints: roundAwardMap.get(player.id)?.points ?? 0,
          placement: roundAwardMap.get(player.id)?.placement ?? null,
          initialIndex: index,
        }))
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }

          if (right.roundPoints !== left.roundPoints) {
            return right.roundPoints - left.roundPoints;
          }

          const leftPlacement = left.placement ?? Number.MAX_SAFE_INTEGER;
          const rightPlacement = right.placement ?? Number.MAX_SAFE_INTEGER;

          if (leftPlacement !== rightPlacement) {
            return leftPlacement - rightPlacement;
          }

          return left.initialIndex - right.initialIndex;
        })
      : [];
  const isAwaitingFirstTurnStart =
    gameState.phase === "playing" && gameState.isAwaitingFirstTurnStart;
  const isPausedTurn =
    gameState.phase === "playing" &&
    !isChallengeActive &&
    !gameState.isAwaitingFirstTurnStart &&
    gameState.activePlayerId !== null &&
    gameState.turnStartedAt === null &&
    !gameState.isSafeToFinish;
  const requiresManualTurnStart =
    gameState.phase === "playing" && (isAwaitingFirstTurnStart || isPausedTurn);
  const requiresPrimaryAction =
    requiresManualTurnStart || isAwaitingRoundSummary;
  const isGmOpeningWordMode =
    gameState.phase === "playing" &&
    isAwaitingFirstTurnStart &&
    isGmOpeningWordEnabled &&
    !isChallengeActive;
  const editableInputValue = isGmOpeningWordMode
    ? gmOpeningWordDraft
    : gameState.currentInput;
  const answerInputLabel = isGmOpeningWordMode
    ? "คำตั้งต้นของผู้คุมเกม"
    : `คำตอบของ ${playScreenPlayer?.name ?? ""}`;
  const answerInputPlaceholder = isGmOpeningWordMode
    ? "พิมพ์คำตั้งต้นของผู้คุมเกม"
    : "พิมพ์คำตอบของผู้เล่น";
  const canSubmitGmOpeningWord =
    isGmOpeningWordMode &&
    !isSubmittingTurn &&
    gmOpeningWordDraft.trim().length > 0;
  const canSubmitCurrentTurn =
    gameState.phase === "playing" &&
    !isChallengeActive &&
    !requiresPrimaryAction &&
    !isSubmittingTurn &&
    gameState.currentInput.trim().length > 0 &&
    (gameState.isSafeToFinish || gameState.timeLeftMs > 0);
  const challengeSpeakerName =
    challengeState?.currentSpeaker === "challenger"
      ? (selectedChallenger?.name ?? "ผู้ชาเลนจ์")
      : challengeState?.currentSpeaker === "challenged"
        ? (selectedChallengedPlayer?.name ?? "ผู้ถูกชาเลนจ์")
        : null;
  const challengeTimeLeftMs =
    challengeState?.timeLeftMs ?? CHALLENGE_DEBATE_SEGMENT_DURATION_MS;
  const challengeSegmentIndex = challengeState?.segmentIndex ?? 0;
  const timerTone = isAwaitingRoundSummary
    ? "is-safe"
    : isChallengeSelecting
      ? "is-pending"
      : isChallengeDebating
        ? challengeTimeLeftMs <= 3000
          ? "is-urgent"
          : ""
        : isChallengeJudging
          ? "is-safe"
          : gameState.phase === "playing" && isAwaitingFirstTurnStart
            ? "is-pending"
            : gameState.phase === "playing" && isPausedTurn
              ? "is-paused"
              : gameState.phase === "playing" && gameState.isSafeToFinish
                ? "is-safe"
                : gameState.phase === "playing" && gameState.timeLeftMs <= 1000
                  ? "is-urgent"
                  : "";
  const timerValue = isAwaitingRoundSummary
    ? "สรุปรอบ"
    : isChallengeSelecting
      ? "ชาเลนจ์"
      : isChallengeDebating
        ? "ชาเลนจ์"
        : isChallengeJudging
          ? "ชาเลนจ์"
          : requiresManualTurnStart
            ? "รอเริ่ม"
            : gameState.phase === "playing" && gameState.isSafeToFinish
              ? "ผ่านแล้ว"
              : gameState.phase === "playing"
                ? `${formatSeconds(gameState.timeLeftMs)}s`
                : "";
  const timerAriaLabel = isAwaitingRoundSummary
    ? "เวลา สรุปรอบ"
    : isChallengeSelecting
      ? "เวลา เลือกการชาเลนจ์"
      : isChallengeDebating
        ? "กำลังชาเลนจ์"
        : isChallengeJudging
          ? "กำลังตัดสินการชาเลนจ์"
          : requiresManualTurnStart
            ? "เวลา รอเริ่ม"
            : gameState.phase === "playing" && gameState.isSafeToFinish
              ? "เวลา ผ่านแล้ว"
              : gameState.phase === "playing"
                ? `เวลาเหลือ ${formatSeconds(gameState.timeLeftMs)} วินาที`
                : "เวลา";
  const displayedTimerValue = isGmOpeningWordMode ? "รอคำตั้งต้น" : timerValue;
  const displayedTimerAriaLabel = isGmOpeningWordMode
    ? "เวลารอคำตั้งต้นของผู้คุมเกม"
    : timerAriaLabel;
  const challengeNote = isChallengeSelecting
    ? null
    : isChallengeDebating && challengeSpeakerName
      ? `${challengeSpeakerName} กำลังพูด`
      : isChallengeJudging
        ? "ครบสองรอบโต้วาทีแล้ว เลือกผลตัดสิน"
        : null;
  const currentInputSyllables = currentInputSegmentation?.syllables ?? [];
  const currentInputSegmentationMeta = currentInputSegmentation
    ? `${currentInputSegmentation.engine} · ${currentInputSegmentation.modelVersion}`
    : null;

  const resetChallengeChallengerTypeahead = useCallback(() => {
    setChallengeChallengerSearchValue("");
    setChallengeChallengerActiveOptionId(null);
  }, []);

  const clearTransientUiState = useCallback(() => {
    challengeHistoryRestorePauseRef.current = false;
    setCurrentInputSegmentation(null);
    setSegmentationError(null);
    setIsSegmentingCurrentInput(false);
    setIsSubmittingTurn(false);
    resetChallengeChallengerTypeahead();
  }, [resetChallengeChallengerTypeahead]);

  const restoreHistorySnapshot = useCallback((snapshot: HistorySnapshot) => {
    const restoredGameState = pauseGameStateForHistoryRestore(
      snapshot.sessionState.gameState,
      Date.now(),
    );

    if (restoredGameState === snapshot.sessionState.gameState) {
      return snapshot;
    }

    return {
      ...snapshot,
      sessionState: {
        ...snapshot.sessionState,
        gameState: restoredGameState,
      },
    };
  }, []);

  async function getSyllableSegmentation(text: string, signal?: AbortSignal) {
    const normalizedText = text.trim();

    if (!normalizedText) {
      return {
        syllables: [],
        engine: DEFAULT_SYLLABLE_ENGINE,
        mode: "written" as const,
        modelVersion: "empty-input",
      };
    }

    const cacheKey = getSegmentationCacheKey(normalizedText);
    const cachedResult = segmentationCacheRef.current.get(cacheKey);

    if (cachedResult) {
      return cachedResult;
    }

    const result = await segmentThaiText(normalizedText, {
      engine: DEFAULT_SYLLABLE_ENGINE,
      signal,
    });

    segmentationCacheRef.current.set(cacheKey, result);
    return result;
  }

  const applyEphemeralGameUpdate = useCallback(
    (updater: (currentGameState: GameState) => GameState) => {
      updatePresent((current) => {
        const nextGameState = updater(current.sessionState.gameState);

        if (nextGameState === current.sessionState.gameState) {
          return current;
        }

        return {
          ...current,
          sessionState: applyFinishedSessionState(
            current.sessionState,
            nextGameState,
          ),
        };
      });
    },
    [updatePresent],
  );

  const setGmOpeningWordDraft = useCallback(
    (nextValue: string | ((current: string) => string)) => {
      updatePresent((current) => {
        const resolvedValue =
          typeof nextValue === "function"
            ? nextValue(current.uiState.gmOpeningWordDraft)
            : nextValue;

        if (resolvedValue === current.uiState.gmOpeningWordDraft) {
          return current;
        }

        return {
          ...current,
          uiState: {
            ...current.uiState,
            gmOpeningWordDraft: resolvedValue,
          },
        };
      });
    },
    [updatePresent],
  );

  const commitGameAction = useCallback(
    (
      updater: (currentGameState: GameState) => GameState,
      options?: {
        nextGmOpeningWordDraft?: string | ((current: string) => string);
      },
    ) => {
      commitPresent((current) => {
        const nextGameState = updater(current.sessionState.gameState);
        const nextSessionState =
          nextGameState === current.sessionState.gameState
            ? current.sessionState
            : applyFinishedSessionState(current.sessionState, nextGameState);
        const nextGmOpeningWordDraft =
          options?.nextGmOpeningWordDraft === undefined
            ? current.uiState.gmOpeningWordDraft
            : typeof options.nextGmOpeningWordDraft === "function"
              ? options.nextGmOpeningWordDraft(
                current.uiState.gmOpeningWordDraft,
              )
              : options.nextGmOpeningWordDraft;

        if (
          nextSessionState === current.sessionState &&
          nextGmOpeningWordDraft === current.uiState.gmOpeningWordDraft
        ) {
          return current;
        }

        return {
          sessionState: nextSessionState,
          uiState:
            nextGmOpeningWordDraft === current.uiState.gmOpeningWordDraft
              ? current.uiState
              : {
                ...current.uiState,
                gmOpeningWordDraft: nextGmOpeningWordDraft,
              },
        };
      });
      challengeHistoryRestorePauseRef.current = false;
    },
    [commitPresent],
  );
  const canUndoGameHistory = gameState.phase !== "setup" && canUndo;
  const canRedoGameHistory = gameState.phase !== "setup" && canRedo;

  const handleUndo = useCallback(() => {
    if (!canUndoGameHistory) {
      return;
    }

    const currentGameState = historySnapshot.sessionState.gameState;

    const isTimerRunning =
      currentGameState.phase === "playing" &&
      currentGameState.turnStartedAt !== null &&
      !currentGameState.isHistoryRestorePause;

    if (isTimerRunning || currentGameState.isSafeToFinish) {
      if (currentGameState.isHistoryRestorePause) {
        return;
      }

      clearTransientUiState();

      const restoredGameState = pauseGameStateForHistoryRestore(
        currentGameState,
        Date.now(),
      );

      if (restoredGameState === currentGameState) {
        return;
      }

      updatePresent((current) => ({
        ...current,
        sessionState: {
          ...current.sessionState,
          gameState: restoredGameState,
        },
      }));
      return;
    }

    if (currentGameState.phase === "finished") {
      const previousSnapshot = historyState.past[historyState.past.length - 1];
      if (!previousSnapshot) {
        return;
      }

      clearTransientUiState();

      const restoredSnapshot = previousSnapshot.sessionState.gameState
        .isHistoryRestorePause
        ? previousSnapshot
        : restoreHistorySnapshot(previousSnapshot);

      undoPresent(() => restoredSnapshot);
      return;
    }

    const previousSnapshot = historyState.past[historyState.past.length - 1];
    if (!previousSnapshot) {
      return;
    }

    clearTransientUiState();

    const restoredSnapshot = previousSnapshot.sessionState.gameState
      .isHistoryRestorePause
      ? previousSnapshot
      : restoreHistorySnapshot(previousSnapshot);

    undoPresent(() => restoredSnapshot);
  }, [
    canUndoGameHistory,
    clearTransientUiState,
    historySnapshot,
    historyState.past,
    restoreHistorySnapshot,
    undoPresent,
    updatePresent,
  ]);

  const handleRedo = useCallback(() => {
    if (!canRedoGameHistory) {
      return;
    }

    const nextSnapshot = historyState.future[0];
    if (!nextSnapshot) {
      return;
    }

    clearTransientUiState();

    const restoredSnapshot = nextSnapshot.sessionState.gameState
      .isHistoryRestorePause
      ? nextSnapshot
      : restoreHistorySnapshot(nextSnapshot);

    redoPresent(() => restoredSnapshot);
  }, [
    canRedoGameHistory,
    clearTransientUiState,
    historyState.future,
    restoreHistorySnapshot,
    redoPresent,
  ]);

  useTurnTimer({
    durationMs: TURN_DURATION_MS,
    active: gameState.phase === "playing" && gameState.activePlayerId !== null,
    safeToFinish: gameState.phase === "playing" && gameState.isSafeToFinish,
    startedAt: gameState.phase === "playing" ? gameState.turnStartedAt : null,
    onTick: (timeLeftMs, startedAt) => {
      applyEphemeralGameUpdate((current) => {
        if (
          current.phase !== "playing" ||
          current.turnStartedAt !== startedAt
        ) {
          return current;
        }

        return {
          ...current,
          timeLeftMs,
        };
      });
    },
    onExpire: (startedAt) => {
      commitGameAction((current) => {
        if (
          current.phase !== "playing" ||
          current.isSafeToFinish ||
          current.turnStartedAt !== startedAt
        ) {
          return current;
        }

        return advanceTurn(current, { type: "timeout" });
      });
    },
  });

  useTurnTimer({
    durationMs: CHALLENGE_DEBATE_SEGMENT_DURATION_MS,
    active:
      gameState.phase === "playing" &&
      isChallengeDebating &&
      !challengeState?.segmentAwaitingContinue,
    safeToFinish: false,
    startedAt:
      gameState.phase === "playing" && isChallengeDebating
        ? (challengeState?.segmentStartedAt ?? null)
        : null,
    onTick: (timeLeftMs, startedAt) => {
      applyEphemeralGameUpdate((current) =>
        tickChallengeDebate(current, timeLeftMs, startedAt),
      );
    },
    onExpire: (startedAt) => {
      commitGameAction((current) => advanceChallengeDebate(current, startedAt));
    },
  });

  useEffect(() => {
    if (gameState.phase !== "playing") {
      return;
    }

    if (isChallengeSelecting) {
      challengeChallengerInputRef.current?.focus();
      return;
    }

    if (isChallengeJudging) {
      challengeDecisionButtonRef.current?.focus();
      return;
    }

    if (isChallengeDebating && challengeState?.segmentAwaitingContinue) {
      challengeResumeButtonRef.current?.focus();
      return;
    }

    if (isChallengeDebating) {
      return;
    }

    if (isGmOpeningWordMode) {
      answerInputRef.current?.focus();
      return;
    }

    if (isAwaitingFirstTurnStart || isPausedTurn) {
      startFirstTurnButtonRef.current?.focus();
      return;
    }

    if (!isAwaitingFirstTurnStart && !isPausedTurn) {
      answerInputRef.current?.focus();
    }
  }, [
    gameState.phase,
    gameState.activePlayerId,
    gameState.turnStartedAt,
    isAwaitingFirstTurnStart,
    isGmOpeningWordMode,
    gameState.isAwaitingFirstTurnStart,
    isPausedTurn,
    isChallengeSelecting,
    isChallengeJudging,
    isChallengeDebating,
    challengeState?.segmentAwaitingContinue,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (event.key === "F2") {
        if (!canOpenChallenge) {
          return;
        }

        event.preventDefault();
        clearTransientUiState();
        applyEphemeralGameUpdate((current) => beginChallengeSelection(current));
        return;
      }

      if (event.key === "Escape") {
        if (!isChallengeSelecting) {
          return;
        }

        event.preventDefault();
        applyEphemeralGameUpdate((current) => cancelChallenge(current));
        return;
      }

      if (event.key !== "Enter" || !isChallengeDebating) {
        return;
      }

      event.preventDefault();
      commitGameAction((current) => {
        if (
          current.phase === "playing" &&
          current.challenge.status === "debating" &&
          current.challenge.segmentAwaitingContinue
        ) {
          return challengeHistoryRestorePauseRef.current
            ? resumePausedChallengeFromHistory(current)
            : resumeChallengeDebate(current);
        }

        if (
          current.phase !== "playing" ||
          current.challenge.status !== "debating" ||
          current.challenge.segmentStartedAt === null
        ) {
          return current;
        }

        return advanceChallengeDebate(
          current,
          current.challenge.segmentStartedAt,
        );
      });
    }

    window.addEventListener("keydown", handleWindowKeyDown);

    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [
    canOpenChallenge,
    clearTransientUiState,
    commitGameAction,
    isChallengeSelecting,
    isChallengeDebating,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handleUndoRedoKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.repeat) {
        return;
      }

      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      const isKeyZ =
        event.code === "KeyZ" || event.key.toLocaleLowerCase() === "z";
      const isKeyY =
        event.code === "KeyY" || event.key.toLocaleLowerCase() === "y";

      if (!isKeyZ && !isKeyY) {
        return;
      }

      const isRedo = isKeyY || (isKeyZ && event.shiftKey);

      if (isRedo) {
        if (!canRedoGameHistory || isSubmittingTurn) {
          return;
        }

        event.preventDefault();
        handleRedo();
        return;
      }

      if (isKeyZ && !event.shiftKey) {
        if (!canUndoGameHistory || isSubmittingTurn) {
          return;
        }

        event.preventDefault();
        handleUndo();
      }
    }

    window.addEventListener("keydown", handleUndoRedoKeyDown);

    return () => {
      window.removeEventListener("keydown", handleUndoRedoKeyDown);
    };
  }, [
    canRedoGameHistory,
    canUndoGameHistory,
    handleRedo,
    handleUndo,
    isSubmittingTurn,
  ]);

  useEffect(() => {
    if (!isAwaitingRoundSummary) {
      return;
    }

    startFirstTurnButtonRef.current?.focus();
  }, [isAwaitingRoundSummary]);

  useEffect(() => {
    if (isChallengeSelecting) {
      return;
    }

    resetChallengeChallengerTypeahead();
  }, [isChallengeSelecting, resetChallengeChallengerTypeahead]);

  useEffect(() => {
    if (!isChallengeSelecting) {
      return;
    }

    const activeOptionIsVisible =
      challengeChallengerActiveOptionId !== null &&
      filteredChallengeChallengerOptions.some(
        (player) => player.id === challengeChallengerActiveOptionId,
      );

    if (activeOptionIsVisible) {
      return;
    }

    const nextActiveOptionId =
      normalizedChallengeChallengerSearch.length > 0
        ? (filteredChallengeChallengerOptions[0]?.id ?? null)
        : (challengeState?.challengerPlayerId ?? null);

    if (nextActiveOptionId === challengeChallengerActiveOptionId) {
      return;
    }

    setChallengeChallengerActiveOptionId(nextActiveOptionId);
  }, [
    challengeChallengerActiveOptionId,
    challengeState?.challengerPlayerId,
    filteredChallengeChallengerOptions,
    isChallengeSelecting,
    normalizedChallengeChallengerSearch,
  ]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SYLLABLE_DEBUG_STORAGE_KEY,
        String(isSyllableDebugVisible),
      );
    } catch {
      return;
    }
  }, [isSyllableDebugVisible]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        GM_OPENING_WORD_STORAGE_KEY,
        String(isGmOpeningWordEnabled),
      );
    } catch {
      return;
    }
  }, [isGmOpeningWordEnabled]);

  useEffect(() => {
    if (gameState.phase !== "finished" || gameState.isAwaitingRoundSummary) {
      return;
    }

    leaderboardActionButtonRef.current?.focus();
  }, [
    gameState.phase,
    gameState.isAwaitingRoundSummary,
    sessionState.completedRoundsInMatch,
  ]);

  useEffect(() => {
    if (gameState.phase !== "playing") {
      setCurrentInputSegmentation(null);
      setSegmentationError(null);
      setIsSegmentingCurrentInput(false);
      return;
    }

    if (
      (requiresManualTurnStart && !isGmOpeningWordMode) ||
      isChallengeActive
    ) {
      setCurrentInputSegmentation(null);
      setIsSegmentingCurrentInput(false);
      return;
    }

    const normalizedInput = editableInputValue.trim();

    if (!normalizedInput) {
      setCurrentInputSegmentation(null);
      setSegmentationError(null);
      setIsSegmentingCurrentInput(false);
      return;
    }

    const cacheKey = getSegmentationCacheKey(normalizedInput);
    const cachedResult = segmentationCacheRef.current.get(cacheKey);

    if (cachedResult) {
      setCurrentInputSegmentation(cachedResult);
      setSegmentationError(null);
      setIsSegmentingCurrentInput(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      void getSyllableSegmentation(normalizedInput, controller.signal)
        .then((result) => {
          setCurrentInputSegmentation(result);
          setSegmentationError(null);
        })
        .catch((error) => {
          if (controller.signal.aborted) {
            return;
          }

          setCurrentInputSegmentation(null);
          setSegmentationError(getSegmentationErrorMessage(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsSegmentingCurrentInput(false);
          }
        });
    }, SYLLABLE_REQUEST_DEBOUNCE_MS);

    setSegmentationError(null);
    setIsSegmentingCurrentInput(true);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [
    gameState.phase,
    editableInputValue,
    requiresManualTurnStart,
    isChallengeActive,
    isGmOpeningWordMode,
  ]);

  function handleConfirmPlayers() {
    if (!validation.canStart) {
      return;
    }

    setCurrentInputSegmentation(null);
    setSegmentationError(null);
    setIsSegmentingCurrentInput(false);
    resetChallengeChallengerTypeahead();
    challengeHistoryRestorePauseRef.current = false;

    const rosterDrafts = playerNamesFromTextarea.map((name) =>
      createPlayerDraft(name),
    );

    resetHistory({
      sessionState: {
        gameState: createConfirmedGameState(
          prepareRoster(rosterDrafts),
          TURN_DURATION_MS,
          getTurnDirectionForMatchRound(1),
        ),
        leaderboardScores: {},
        roundScoreBreakdownsInMatch: [],
        completedRoundsInMatch: 0,
      },
      uiState: createInitialHistoryUiState(),
    });
  }

  function handleStartFirstTurn() {
    setSegmentationError(null);

    if (gameState.isHistoryRestorePause) {
      applyEphemeralGameUpdate(resumePausedTurnFromHistory);
    } else {
      commitGameAction(startActiveTurn);
    }
  }

  function handleToggleGmOpeningWord() {
    if (isSubmittingTurn) {
      return;
    }

    if (isGmOpeningWordEnabled) {
      setGmOpeningWordDraft("");
      setCurrentInputSegmentation(null);
      setSegmentationError(null);
      setIsSegmentingCurrentInput(false);
    }

    setIsGmOpeningWordEnabled((current) => !current);
  }

  function handleHostEliminateNotNoun() {
    commitGameAction((current) =>
      hostEliminateCurrentPlayer(current, "not_noun"),
    );
  }

  function handleContinueToRoundSummary() {
    commitGameAction((current) => acknowledgeRoundSummary(current));
  }

  function handleResumeChallengeDebate() {
    commitGameAction((current) =>
      challengeHistoryRestorePauseRef.current
        ? resumePausedChallengeFromHistory(current)
        : resumeChallengeDebate(current),
    );
  }

  function handleAdvanceChallengeDebate() {
    commitGameAction((current) => {
      if (
        current.phase !== "playing" ||
        current.challenge.status !== "debating" ||
        current.challenge.segmentStartedAt === null
      ) {
        return current;
      }

      return advanceChallengeDebate(
        current,
        current.challenge.segmentStartedAt,
      );
    });
  }

  function handleResumeChallengeDebateKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    handleResumeChallengeDebate();
  }

  function handleStartFirstTurnKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    if (isAwaitingRoundSummary) {
      handleContinueToRoundSummary();
      return;
    }

    handleStartFirstTurn();
  }

  function handleAnswerChange(event: ChangeEvent<HTMLInputElement>) {
    const { value } = event.target;

    applyEphemeralGameUpdate((current) => {
      if (
        current.phase !== "playing" ||
        current.isAwaitingFirstTurnStart ||
        current.turnStartedAt === null
      ) {
        return current;
      }

      return applyInputChange(current, value);
    });
  }

  function handleGmOpeningWordChange(event: ChangeEvent<HTMLInputElement>) {
    setGmOpeningWordDraft(event.target.value);
  }

  async function handleSubmitTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isGmOpeningWordMode) {
      const openingWord = gmOpeningWordDraft.trim();

      if (!openingWord) {
        return;
      }

      const submittedAt = Date.now();

      setIsSubmittingTurn(true);
      setSegmentationError(null);

      try {
        const segmentation = await getSyllableSegmentation(openingWord);

        commitGameAction(
          (current) =>
            startRoundWithOpeningWord(
              current,
              openingWord,
              segmentation.syllables,
              submittedAt,
            ),
          { nextGmOpeningWordDraft: "" },
        );
      } catch (error) {
        setSegmentationError(getSegmentationErrorMessage(error));
      } finally {
        setIsSubmittingTurn(false);
      }

      return;
    }

    const submittedAt = Date.now();
    const currentGameState = sessionState.gameState;

    if (
      currentGameState.phase !== "playing" ||
      currentGameState.isAwaitingFirstTurnStart ||
      currentGameState.turnStartedAt === null
    ) {
      return;
    }

    const answer = currentGameState.currentInput.trim();

    if (!answer) {
      return;
    }

    setIsSubmittingTurn(true);
    setSegmentationError(null);

    try {
      const segmentation = await getSyllableSegmentation(answer);

      commitGameAction((current) => {
        if (
          current.phase !== "playing" ||
          current.isAwaitingFirstTurnStart ||
          current.turnStartedAt === null
        ) {
          return current;
        }

        return advanceTurn(current, {
          type: "submit",
          answer: current.currentInput,
          syllables: segmentation.syllables,
          now: submittedAt,
        });
      });
    } catch (error) {
      setSegmentationError(getSegmentationErrorMessage(error));
    } finally {
      setIsSubmittingTurn(false);
    }
  }

  function handleOpenChallenge() {
    if (gameState.phase !== "playing") {
      return;
    }

    resetChallengeChallengerTypeahead();
    setCurrentInputSegmentation(null);
    setSegmentationError(null);
    setIsSegmentingCurrentInput(false);
    setIsSubmittingTurn(false);

    applyEphemeralGameUpdate((current) => beginChallengeSelection(current));
  }

  function handleCancelChallenge() {
    resetChallengeChallengerTypeahead();
    applyEphemeralGameUpdate((current) => cancelChallenge(current));
  }

  function handleChallengeChallengerChange(nextKey: Key | null) {
    const nextValue =
      nextKey === null || nextKey === undefined ? null : `${nextKey}`.trim();
    const nextChallenger =
      challengeChallengerOptions.find((player) => player.id === nextValue) ??
      null;

    setChallengeChallengerSearchValue(nextChallenger?.name ?? "");
    setChallengeChallengerActiveOptionId(nextValue || null);
    applyEphemeralGameUpdate((current) =>
      updateChallengeSelection(current, {
        challengerPlayerId: nextValue || null,
      }),
    );
  }

  function handleChallengeChallengerSearchChange(nextValue: string) {
    setChallengeChallengerSearchValue(nextValue);
    const nextFilteredOptions = getMatchingChallengeChallengerOptions(
      challengeChallengerOptions,
      nextValue,
    );
    const normalizedNextValue = normalizeChallengeTypeaheadText(nextValue);
    setChallengeChallengerActiveOptionId(
      normalizedNextValue.length > 0
        ? (nextFilteredOptions[0]?.id ?? null)
        : null,
    );

    if (!isChallengeSelecting) {
      return;
    }

    if (challengeState?.challengerPlayerId === null) {
      return;
    }

    const normalizedSelectedChallengerName = normalizeChallengeTypeaheadText(
      selectedChallenger?.name ?? "",
    );

    if (
      normalizedNextValue.length > 0 &&
      normalizedNextValue === normalizedSelectedChallengerName
    ) {
      return;
    }

    applyEphemeralGameUpdate((current) =>
      updateChallengeSelection(current, {
        challengerPlayerId: null,
      }),
    );
  }

  function handleChallengeChallengerInputKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    if (
      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
      filteredChallengeChallengerOptions.length > 0
    ) {
      event.preventDefault();

      const currentIndex = filteredChallengeChallengerOptions.findIndex(
        (player) => player.id === preferredChallengeChallengerId,
      );
      const offset = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        currentIndex === -1
          ? event.key === "ArrowDown"
            ? 0
            : filteredChallengeChallengerOptions.length - 1
          : Math.min(
            filteredChallengeChallengerOptions.length - 1,
            Math.max(0, currentIndex + offset),
          );

      setChallengeChallengerActiveOptionId(
        filteredChallengeChallengerOptions[nextIndex]?.id ?? null,
      );
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    const nextChallengerId = preferredChallengeChallengerId;

    if (!nextChallengerId) {
      return;
    }

    if (
      selectedChallengedAnswer !== null &&
      selectedChallengePreviousAnswer !== null
    ) {
      handleStartChallenge(nextChallengerId);
      return;
    }

    if (challengeState?.challengerPlayerId !== nextChallengerId) {
      const nextChallenger =
        challengeChallengerOptions.find(
          (player) => player.id === nextChallengerId,
        ) ?? null;
      setChallengeChallengerSearchValue(nextChallenger?.name ?? "");
      setChallengeChallengerActiveOptionId(nextChallengerId);
      applyEphemeralGameUpdate((current) =>
        updateChallengeSelection(current, {
          challengerPlayerId: nextChallengerId,
        }),
      );
    }

    challengeChallengedAnswerSelectRef.current?.focus();
  }

  function handleStartChallenge(challengerPlayerId?: string) {
    const nextChallengerId =
      challengerPlayerId ?? challengeState?.challengerPlayerId ?? null;

    if (!nextChallengerId) {
      return;
    }

    resetChallengeChallengerTypeahead();
    commitGameAction((current) => {
      if (current.phase !== "playing") {
        return current;
      }

      if (current.challenge.status !== "selecting") {
        return current;
      }

      const stateWithChallenger =
        current.challenge.challengerPlayerId === nextChallengerId
          ? current
          : updateChallengeSelection(current, {
            challengerPlayerId: nextChallengerId,
          });

      return startChallengeDebate(stateWithChallenger);
    });
  }

  function handleChallengeDecision(decision: "connects" | "not_connects") {
    commitGameAction((current) => resolveChallenge(current, decision));
  }

  function handleChallengeDecisionKeyDown(
    decision: "connects" | "not_connects",
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    handleChallengeDecision(decision);
  }

  function handleReplaySamePlayers() {
    if (!validation.canStart) {
      return;
    }

    setCurrentInputSegmentation(null);
    setSegmentationError(null);
    setIsSegmentingCurrentInput(false);
    resetChallengeChallengerTypeahead();
    challengeHistoryRestorePauseRef.current = false;

    const shouldStartNewMatch =
      sessionState.completedRoundsInMatch >= MATCH_ROUNDS_PER_MATCH;

    if (shouldStartNewMatch) {
      segmentationCacheRef.current.clear();
    }

    const nextMatchRound = shouldStartNewMatch
      ? 1
      : sessionState.completedRoundsInMatch + 1;

    resetHistory({
      sessionState: {
        gameState: createConfirmedGameState(
          prepareRoster(playerDrafts),
          TURN_DURATION_MS,
          getTurnDirectionForMatchRound(nextMatchRound),
        ),
        leaderboardScores: shouldStartNewMatch
          ? {}
          : sessionState.leaderboardScores,
        roundScoreBreakdownsInMatch: shouldStartNewMatch
          ? []
          : sessionState.roundScoreBreakdownsInMatch,
        completedRoundsInMatch: shouldStartNewMatch
          ? 0
          : sessionState.completedRoundsInMatch,
      },
      uiState: createInitialHistoryUiState(),
    });
  }

  function handleResetAll() {
    segmentationCacheRef.current.clear();
    setCurrentInputSegmentation(null);
    setSegmentationError(null);
    setIsSegmentingCurrentInput(false);
    setIsSubmittingTurn(false);
    resetChallengeChallengerTypeahead();
    challengeHistoryRestorePauseRef.current = false;
    setPlayerDrafts(ensureTrailingBlankDraft(createInitialDrafts()));
    resetHistory(createInitialHistorySnapshot());
  }

  return (
    <main className="app-shell">
      {gameState.phase === "setup" && (
        <section className="phase-screen setup-screen">
          <div className="surface-card setup-card">
            <div className="panel-header setup-header">
              <div className="setup-copy">
                <h1>จัดรายชื่อผู้เล่น</h1>
              </div>
              <div className="setup-tooltip">
                <button
                  type="button"
                  className="ghost-button symbol-button setup-help-button"
                  aria-label="วิธีจัดรายชื่อผู้เล่น"
                  aria-describedby="setup-help-tooltip"
                  title="วิธีจัดรายชื่อผู้เล่น"
                >
                  <HelpCircle size={18} aria-hidden="true" />
                </button>
                <div
                  className="setup-tooltip-panel"
                  id="setup-help-tooltip"
                  role="tooltip"
                >
                  <ul className="setup-tooltip-list">
                    <li>Alt+ArrowUp/Down: ย้ายบรรทัด</li>
                    <li>Shift+Alt+ArrowUp/Down: ทำซ้ำบรรทัด</li>
                    <li>Esc: ไปที่ปุ่มยืนยัน</li>
                  </ul>
                </div>
              </div>
            </div>

            <p className="sr-only">
              พิมพ์หรือวางรายชื่อผู้เล่น หนึ่งบรรทัดต่อชื่อ ใช้ Alt+Arrow
              เพื่อย้ายบรรทัด Shift+Alt+Arrow เพื่อทำซ้ำบรรทัด และ Esc
              เพื่อออกจากช่องพิมพ์ แล้วกดยืนยันผู้เล่น
            </p>

            <div className="player-editor-wrapper">
              <CodeMirror
                basicSetup={{
                  lineNumbers: true,
                  highlightActiveLineGutter: true,
                  highlightActiveLine: false,
                  foldGutter: false,
                  dropCursor: false,
                  allowMultipleSelections: false,
                  indentOnInput: false,
                  bracketMatching: false,
                  closeBrackets: false,
                  autocompletion: false,
                  rectangularSelection: false,
                  crosshairCursor: false,
                  highlightSelectionMatches: false,
                  searchKeymap: false,
                }}
                extensions={playerEditorExtensions}
                value={playerNamesTextarea}
                onChange={setPlayerNamesTextarea}
                placeholder="พิมพ์หรือวางรายชื่อผู้เล่น (หนึ่งบรรทัดต่อชื่อ)"
                autoFocus
              />
            </div>

            <div className="setup-footer">
              <p
                className={`validation-note ${validation.canStart ? "is-ready" : ""
                  }`}
              >
                {validation.playerCount < 2
                  ? "ต้องมีผู้เล่นอย่างน้อย 2 คน"
                  : `พร้อมยืนยันผู้เล่น ${validation.playerCount} คน`}
              </p>

              <button
                type="button"
                className="primary-button start-button"
                disabled={!validation.canStart}
                onClick={handleConfirmPlayers}
                aria-label="ยืนยันผู้เล่น"
                title="ยืนยันผู้เล่น"
              >
                <span className="button-copy">ยืนยันผู้เล่น</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {playScreenPlayer &&
        (gameState.phase === "playing" || isAwaitingRoundSummary) && (
          <section className={`phase-screen play-screen ${!isFocusSidebarOpen ? "sidebar-collapsed" : ""}`}>
            {isChallengeActive ? (
              <section
                className="surface-card board-card challenge-standalone-card"
                aria-label="ชาเลนจ์"
              >
                <div className="panel-header compact challenge-header-unified">
                  <h2 className="challenge-title">ชาเลนจ์คำไม่เชื่อม</h2>
                </div>

                {isChallengeSelecting && (
                  <div className="challenge-content">
                    <div className="challenge-field-grid">
                      <div className="challenge-field">
                        <ComboBox<ChallengeChallengerOption>
                          id="challenge-challenger-search"
                          className="challenge-challenger-combobox"
                          allowsEmptyCollection
                          defaultFilter={matchesChallengeTypeaheadCandidate}
                          inputValue={challengeChallengerSearchValue}
                          menuTrigger="focus"
                          onInputChange={handleChallengeChallengerSearchChange}
                          onSelectionChange={handleChallengeChallengerChange}
                          selectedKey={challengeState?.challengerPlayerId ?? null}
                        >
                          <Label>พิมพ์ชื่อผู้ชาเลนจ์</Label>
                          <Input
                            ref={challengeChallengerInputRef}
                            className="text-input challenge-search-input"
                            onKeyDown={handleChallengeChallengerInputKeyDown}
                            placeholder="พิมพ์ชื่อผู้ชาเลนจ์"
                            autoComplete="off"
                          />
                          <Popover className="challenge-challenger-popover">
                            <ChallengeChallengerListBox
                              activeSuggestionId={preferredChallengeChallengerId}
                              options={challengeChallengerOptions}
                            />
                          </Popover>
                        </ComboBox>
                      </div>

                      <div className="challenge-field">
                        <label id="challenged-answer-label">
                          คำที่ถูกชาเลนจ์
                        </label>
                        <select
                          ref={challengeChallengedAnswerSelectRef}
                          className="text-input challenge-select"
                          aria-labelledby="challenged-answer-label"
                          value={challengeState?.challengedAnswerId ?? ""}
                          disabled={challengeableAnswers.length === 0}
                          onChange={(event) => {
                            const nextAnswerId = event.target.value || null;

                            applyEphemeralGameUpdate((current) =>
                              updateChallengeSelection(current, {
                                challengedAnswerId: nextAnswerId,
                              }),
                            );
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") {
                              return;
                            }

                            event.preventDefault();

                            if (!preferredChallengeChallengerId) {
                              challengeChallengerInputRef.current?.focus();
                              return;
                            }

                            handleStartChallenge(preferredChallengeChallengerId);
                          }}
                        >
                          <option value="" disabled>
                            เลือกคำที่ถูกชาเลนจ์
                          </option>
                          {[...challengeableAnswers]
                            .reverse()
                            .slice(0, 3)
                            .map((answerRecord: AnswerRecord) => (
                              <option
                                key={answerRecord.id}
                                value={answerRecord.id}
                              >
                                "{answerRecord.answer}" ของ{" "}
                                {answerRecord.playerName}
                              </option>
                            ))}
                        </select>
                        {challengeableAnswers.length === 0 && (
                          <div className="empty-note">
                            ไม่มีคำที่สามารถชาเลนจ์ได้
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="action-row challenge-actions">
                      <button
                        type="button"
                        className="primary-button symbol-button"
                        onClick={() =>
                          handleStartChallenge(
                            preferredChallengeChallengerId ?? undefined,
                          )
                        }
                        disabled={!canStartVisibleChallenge}
                        aria-label="เริ่มการชาเลนจ์"
                        title="เริ่มการชาเลนจ์"
                      >
                        <span className="button-copy">เริ่มการชาเลนจ์</span>
                      </button>
                      <button
                        type="button"
                        className="secondary-button symbol-button"
                        onClick={handleCancelChallenge}
                        aria-label="ยกเลิกการชาเลนจ์"
                        title="ยกเลิกการชาเลนจ์"
                      >
                        <span className="button-copy">ยกเลิก</span>
                      </button>
                    </div>
                  </div>
                )}

                {isChallengeDebating && (
                  <div className="challenge-content">
                    <div className="challenge-chain">
                      <span className="challenge-chain-prev">
                        {selectedChallengePreviousAnswer?.answer ?? "-"}
                      </span>
                      <ChevronRight
                        size={16}
                        aria-hidden="true"
                        className="challenge-chain-arrow"
                      />
                      <span className="challenge-chain-target">
                        <span className="challenge-chain-target-word">
                          {selectedChallengedAnswer?.answer ?? "-"}
                        </span>
                      </span>
                      <span className="challenge-chain-right">
                        <span className="challenge-chain-owner">
                          {selectedChallengedPlayer?.name ?? "-"}
                        </span>
                        <span className="challenge-chain-challenger">
                          <span className="challenge-chain-challenger-label">
                            ถูกชาเลนจ์โดย
                          </span>
                          <span className="challenge-chain-challenger-name">
                            {selectedChallenger?.name ?? "-"}
                          </span>
                        </span>
                      </span>
                    </div>
                    <div className="challenge-debate-controls">
                      <div className="challenge-debate-status">
                        <p className="round-indicator">
                          ช่วง {challengeSegmentIndex + 1}/
                          {CHALLENGE_DEBATE_SEGMENT_COUNT}
                        </p>
                        <div
                          className={`turn-timer-pill ${timerTone}`}
                          aria-live="polite"
                        >
                          <span>เวลา</span>
                          <strong>{formatSeconds(challengeTimeLeftMs)}s</strong>
                        </div>
                        <span className="challenge-debate-speaker">
                          <strong>{challengeSpeakerName}</strong>
                          <span className="challenge-debate-speaker-role">
                            {challengeState?.currentSpeaker === "challenger"
                              ? "(ผู้ชาเลนจ์)"
                              : "(ผู้ถูกชาเลนจ์)"}
                          </span>
                        </span>
                      </div>
                      {challengeState?.segmentAwaitingContinue ? (
                        <div className="action-row challenge-actions">
                          <button
                            ref={challengeResumeButtonRef}
                            type="button"
                            className="primary-button"
                            onClick={handleResumeChallengeDebate}
                            onKeyDown={handleResumeChallengeDebateKeyDown}
                            aria-label={
                              challengeSegmentIndex === 0 ? "เริ่ม" : "ต่อ"
                            }
                            title={
                              challengeSegmentIndex === 0 ? "เริ่ม" : "ต่อ"
                            }
                          >
                            <span className="button-copy">
                              {challengeSegmentIndex === 0 ? "เริ่ม" : "ต่อ"}
                            </span>
                          </button>
                        </div>
                      ) : (
                        <div className="action-row challenge-actions">
                          <button
                            type="button"
                            className="secondary-button symbol-button"
                            onClick={handleAdvanceChallengeDebate}
                            aria-label="จบช่วง"
                            title="จบช่วง"
                          >
                            <span className="button-copy">จบช่วง</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {isChallengeJudging && (
                  <div className="challenge-content">
                    <div className="challenge-chain">
                      <span className="challenge-chain-prev">
                        {selectedChallengePreviousAnswer?.answer ?? "-"}
                      </span>
                      <ChevronRight
                        size={16}
                        aria-hidden="true"
                        className="challenge-chain-arrow"
                      />
                      <span className="challenge-chain-target">
                        <span className="challenge-chain-target-word">
                          {selectedChallengedAnswer?.answer ?? "-"}
                        </span>
                      </span>
                      <span className="challenge-chain-right">
                        <span className="challenge-chain-owner">
                          {selectedChallengedPlayer?.name ?? "-"}
                        </span>
                        <span className="challenge-chain-challenger">
                          <span className="challenge-chain-challenger-label">
                            ถูกชาเลนจ์โดย
                          </span>
                          <span className="challenge-chain-challenger-name">
                            {selectedChallenger?.name ?? "-"}
                          </span>
                        </span>
                      </span>
                    </div>

                    <div className="action-row challenge-actions">
                      <button
                        ref={challengeDecisionButtonRef}
                        type="button"
                        className="primary-button symbol-button"
                        onClick={() => handleChallengeDecision("connects")}
                        onKeyDown={(event) =>
                          handleChallengeDecisionKeyDown("connects", event)
                        }
                        aria-label="ตัดสินว่าเชื่อม"
                        title="ตัดสินว่าเชื่อม"
                      >
                        <span className="button-copy">เชื่อม</span>
                      </button>
                      <button
                        type="button"
                        className="secondary-button symbol-button"
                        onClick={() => handleChallengeDecision("not_connects")}
                        onKeyDown={(event) =>
                          handleChallengeDecisionKeyDown("not_connects", event)
                        }
                        aria-label="ตัดสินว่าไม่เชื่อม"
                        title="ตัดสินว่าไม่เชื่อม"
                      >
                        <span className="button-copy">ไม่เชื่อม</span>
                      </button>
                    </div>
                  </div>
                )}
              </section>
            ) : (
              <div
                className="focus-main-grid"
              >
                <button
                  type="button"
                  className={`sidebar-toggle-floating ${isFocusSidebarOpen ? "is-open" : ""}`}
                  onClick={() => setIsFocusSidebarOpen((v) => !v)}
                  aria-label={isFocusSidebarOpen ? "ปิดแถบด้านข้าง" : "เปิดแถบด้านข้าง"}
                  title={isFocusSidebarOpen ? "ปิดแถบด้านข้าง" : "เปิดแถบด้านข้าง"}
                >
                  {isFocusSidebarOpen ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
                  )}
                </button>
                <aside className="focus-sidebar surface-card">
                  <div className="sidebar-header">
                    <h2 className="sidebar-title">คิวผู้เล่น</h2>
                    <span className="count-badge">
                      {visiblePlayers.length}
                    </span>
                  </div>

                  <div className="sidebar-scroll-area">
                    <section className="sidebar-group">
                      <ol
                        className="player-board focus-player-board"
                        aria-label="ลำดับผู้เล่น"
                      >
                        {gameState.players.map((player) => {
                          const isCurrent = player.id === displayedActivePlayerId;
                          const isEliminated = player.status === "eliminated";

                          return (
                            <li
                              className={`player-chip ${isCurrent ? "is-current" : ""} ${isEliminated ? "is-out" : ""
                                }`}
                              key={player.id}
                            >
                              <strong className="sidebar-player-name">
                                {player.name}
                              </strong>
                              {isCurrent && (
                                <span className="player-chip-current">
                                  ตอนนี้
                                </span>
                              )}
                              {isEliminated && (
                                <span className="player-chip-out-label">
                                  ตกรอบ
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    </section>
                  </div>
                </aside>

                <main className="focus-stage">
                  {lastAnswer && gameState.phase === "playing" ? (
                    <div className="stage-content">
                      <span className="stage-eyebrow">พยางค์ล่าสุดที่ใช้ต่อ</span>
                      <div className="stage-word-wrapper">
                        <h1 className="stage-word">{lastAnswer}</h1>
                      </div>
                      <p className="stage-instruction">
                        พูดคำนามที่เชื่อมกับคำด้านบน
                      </p>
                    </div>
                  ) : (
                    <div className="stage-placeholder">
                      {isGmOpeningWordMode ? (
                        <p>รอผู้คุมเกมตั้งคำตั้งต้น</p>
                      ) : isAwaitingFirstTurnStart ? (
                        <p>เตรียมพร้อมเริ่มรอบแรก</p>
                      ) : (
                        <p>ต้อนรับสู่เกมคำต่อคำ</p>
                      )}
                    </div>
                  )}
                </main>
              </div>
            )}
            <section className="surface-card play-main-card">
              <form className="answer-panel" onSubmit={handleSubmitTurn}>
                <div className="form-copy">
                  <h1 className="sr-only">ถึงตา {playScreenPlayer.name}</h1>
                  <div className="answer-meta">
                    <p className="round-indicator">
                      รอบ {currentMatchRound}/{MATCH_ROUNDS_PER_MATCH}
                    </p>
                    <p className="player-indicator">{playScreenPlayer.name}</p>
                    {gameState.phase === "playing" && (
                      <div className="action-row-toolbar">
                        <button
                          type="button"
                          className="ghost-button challenge-open-button"
                          onClick={handleOpenChallenge}
                          disabled={!canOpenChallenge}
                          aria-label="ชาเลนจ์"
                          title="ชาเลนจ์ (F2)"
                        >
                          ชาเลนจ์
                        </button>
                      </div>
                    )}
                    {(gameState.phase === "playing" ||
                      gameState.phase === "finished") && (
                        <div
                          className="history-toolbar"
                          role="group"
                          aria-label="ประวัติการเล่น"
                        >
                          <button
                            type="button"
                            className="ghost-button history-action-button"
                            onClick={handleUndo}
                            disabled={!canUndoGameHistory || isSubmittingTurn}
                            aria-label="ย้อนกลับ"
                            title="ย้อนกลับ (Ctrl/Cmd+Z)"
                          >
                            <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M3 10h10a5 5 0 0 1 5 5v2" />
                              <polyline points="3 10 7 6" />
                              <polyline points="3 10 7 14" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="ghost-button history-action-button"
                            onClick={handleRedo}
                            disabled={!canRedoGameHistory || isSubmittingTurn}
                            aria-label="ทำซ้ำ"
                            title="ทำซ้ำ (Shift+Ctrl/Cmd+Z)"
                          >
                            <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M21 10H11a5 5 0 0 0-5 5v2" />
                              <polyline points="21 10 17 6" />
                              <polyline points="21 10 17 14" />
                            </svg>
                          </button>
                          <SettingsDropdown
                            isGmOpeningEnabled={isGmOpeningWordEnabled}
                            isSyllableDebugVisible={isSyllableDebugVisible}
                            onToggleGmOpening={handleToggleGmOpeningWord}
                            onToggleSyllableDebug={() =>
                              setIsSyllableDebugVisible((current) => !current)
                            }
                            isSubmittingTurn={isSubmittingTurn}
                          />
                        </div>
                      )}
                  </div>
                  {challengeNote && (
                    <p
                      className="challenge-note"
                      role="status"
                      aria-live="polite"
                    >
                      {challengeNote}
                    </p>
                  )}

                  {isAwaitingRoundSummary && (
                    <p className="pause-note" role="status" aria-live="polite">
                      {eliminatedPlayerSummaryContent}
                    </p>
                  )}
                  {isPausedTurn && gameState.isEliminationPause && (
                    <p className="pause-note" role="status" aria-live="polite">
                      {eliminatedPlayerSummaryContent}
                    </p>
                  )}
                  {segmentationError && (
                    <p className="segmentation-error" role="alert">
                      {segmentationError}
                    </p>
                  )}
                  <label htmlFor="current-answer" className="sr-only">
                    {answerInputLabel}
                  </label>
                  <p className="sr-only">
                    {isChallengeSelecting
                      ? ""
                      : isChallengeDebating
                        ? challengeNote
                        : isChallengeJudging
                          ? "ครบสองรอบโต้วาทีแล้ว เลือกผลตัดสิน"
                          : isAwaitingRoundSummary
                            ? `${eliminatedPlayerSummary} กดสรุปรอบเพื่อดูตารางคะแนนของ ${playScreenPlayer.name}`
                            : isGmOpeningWordMode
                              ? `ผู้คุมเกมพิมพ์คำตั้งต้นของรอบ แล้วกดเริ่มด้วยคำนี้เพื่อเริ่มจับเวลา ${playScreenPlayer.name}`
                              : isAwaitingFirstTurnStart
                                ? `ยืนยันผู้เล่นแล้ว กดเริ่มรอบแรกเพื่อเริ่มจับเวลา ${playScreenPlayer.name}`
                                : gameState.isHistoryRestorePause
                                  ? "ย้อนประวัติสำเร็จ รอเริ่มจับเวลาใหม่"
                                  : isPausedTurn
                                    ? getPausedTurnInstructions(
                                      latestEliminatedPlayer,
                                      playScreenPlayer.name,
                                    )
                                    : "เมื่อเริ่มพิมพ์ตัวแรกทันเวลาแล้ว ระบบจะล็อกคิวไว้ให้ผู้เล่นคนนี้จนกว่าจะส่งคำ"}
                  </p>
                  {gameState.phase === "playing" &&
                    canOpenChallenge &&
                    !isChallengeActive && (
                      <p className="sr-only">F2 เพื่อเปิดชาเลนจ์</p>
                    )}
                  {isChallengeSelecting && (
                    <p className="sr-only">
                      พิมพ์ชื่อเพื่อกรองและเลือกผู้ชาเลนจ์
                      กดลูกศรลงเพื่อไปที่รายการ Enter เพื่อเริ่มทันที Esc
                      เพื่อยกเลิก
                    </p>
                  )}
                  {isChallengeDebating && (
                    <p className="sr-only">Enter เพื่อข้ามช่วงโต้วาที</p>
                  )}
                  {requiresPrimaryAction && !isGmOpeningWordMode && (
                    <span className="sr-only">ยังไม่เริ่มจับเวลา</span>
                  )}
                </div>

                <div className="answer-controls">
                  <input
                    ref={answerInputRef}
                    id="current-answer"
                    className={`text-input answer-input ${isGmOpeningWordMode ? "is-gm-opening" : ""
                      }`}
                    type="text"
                    value={editableInputValue}
                    onChange={
                      isGmOpeningWordMode
                        ? handleGmOpeningWordChange
                        : handleAnswerChange
                    }
                    placeholder={answerInputPlaceholder}
                    autoComplete="off"
                    disabled={
                      isChallengeActive ||
                      isSubmittingTurn ||
                      (!isGmOpeningWordMode && requiresPrimaryAction)
                    }
                  />
                  <div
                    className={`turn-timer-pill ${timerTone} ${isGmOpeningWordMode ? "is-gm-opening" : ""
                      }`}
                    aria-live="polite"
                    aria-label={displayedTimerAriaLabel}
                  >
                    <span>เวลา</span>
                    <strong>{displayedTimerValue}</strong>
                  </div>
                  {isChallengeActive ? (
                    <button
                      type="button"
                      className="secondary-button symbol-button start-turn-button"
                      disabled
                      aria-label="กำลังชาเลนจ์"
                      title="กำลังชาเลนจ์"
                    >
                      <span className="button-copy">กำลังชาเลนจ์</span>
                    </button>
                  ) : isAwaitingRoundSummary ? (
                    <button
                      ref={startFirstTurnButtonRef}
                      type="button"
                      className="primary-button start-turn-button"
                      onClick={handleContinueToRoundSummary}
                      onKeyDown={handleStartFirstTurnKeyDown}
                      aria-label="สรุปรอบ"
                      title="สรุปรอบ"
                    >
                      <span className="button-copy">สรุปรอบ</span>
                    </button>
                  ) : isGmOpeningWordMode ? (
                    <button
                      type="submit"
                      className="primary-button start-turn-button gm-opening-submit-button"
                      disabled={!canSubmitGmOpeningWord}
                      aria-label="เริ่มด้วยคำนี้"
                      title="เริ่มด้วยคำนี้"
                    >
                      <span className="button-copy">เริ่มด้วยคำนี้</span>
                    </button>
                  ) : requiresManualTurnStart ? (
                    <button
                      ref={startFirstTurnButtonRef}
                      type="button"
                      className="primary-button start-turn-button"
                      onClick={handleStartFirstTurn}
                      onKeyDown={handleStartFirstTurnKeyDown}
                      aria-label={
                        isAwaitingFirstTurnStart
                          ? "เริ่มรอบแรก"
                          : "เริ่มตาถัดไป"
                      }
                      title={
                        isAwaitingFirstTurnStart
                          ? "เริ่มรอบแรก"
                          : "เริ่มตาถัดไป"
                      }
                    >
                      <span className="button-copy">
                        {isAwaitingFirstTurnStart
                          ? "เริ่มรอบแรก"
                          : "เริ่มตาถัดไป"}
                      </span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="secondary-button symbol-button compact-symbol-button"
                        onClick={handleHostEliminateNotNoun}
                        aria-label="คำไม่ใช่คำนาม"
                        title="คำไม่ใช่คำนาม"
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="submit"
                        className="primary-button symbol-button compact-symbol-button"
                        disabled={!canSubmitCurrentTurn}
                        aria-label="ถัดไป"
                        title="ถัดไป"
                      >
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              </form>

            </section>

            {isSyllableDebugVisible && (
              <section
                className="surface-card syllable-debug-card"
                aria-label="การแยกพยางค์"
              >
                <div className="panel-header compact debug-header">
                  <div>
                    <p className="eyebrow">รายละเอียด</p>
                    <h2>การแยกพยางค์ของระบบ</h2>
                  </div>
                </div>

                <div className="syllable-debug-grid">
                  <section
                    className="syllable-debug-group"
                    aria-label="พยางค์ของคำปัจจุบัน"
                  >
                    <h3>คำที่กำลังพิมพ์</h3>
                    {currentInputSegmentationMeta && (
                      <p className="syllable-meta">
                        {currentInputSegmentationMeta}
                      </p>
                    )}
                    <div className="syllable-chip-list">
                      {isSegmentingCurrentInput ? (
                        <span className="syllable-empty">
                          กำลังแยกพยางค์...
                        </span>
                      ) : currentInputSyllables.length > 0 ? (
                        currentInputSyllables.map((syllable, index) => (
                          <span
                            className="syllable-chip is-current"
                            key={`${syllable}-${index}`}
                          >
                            {syllable}
                          </span>
                        ))
                      ) : (
                        <span className="syllable-empty">ยังไม่มีพยางค์</span>
                      )}
                    </div>
                  </section>

                  <section
                    className="syllable-debug-group"
                    aria-label="พยางค์ที่บันทึกในรอบนี้"
                  >
                    <h3>พยางค์ที่บันทึกในรอบนี้</h3>
                    <div className="syllable-chip-list">
                      {gameState.usedSyllablesInRound.length > 0 ? (
                        gameState.usedSyllablesInRound.map(
                          (syllable, index) => (
                            <span
                              className="syllable-chip"
                              key={`${syllable}-${index}`}
                            >
                              {syllable}
                            </span>
                          ),
                        )
                      ) : (
                        <span className="syllable-empty">ยังไม่มีพยางค์</span>
                      )}
                    </div>
                  </section>
                </div>
              </section>
            )}
          </section>
        )}

      {gameState.phase === "finished" &&
        winner &&
        !gameState.isAwaitingRoundSummary && (
          <section className="phase-screen result-screen">
            <section className="surface-card leaderboard-card result-leaderboard-card">
              <div className="panel-header compact">
                <div>
                  <h2>ตารางคะแนน</h2>
                </div>
              </div>

              <div className="leaderboard-table-wrap">
                <table
                  className="leaderboard-table"
                  aria-label="ตารางคะแนนสะสม"
                >
                  <thead>
                    <tr>
                      <th scope="col">ผู้เล่น</th>
                      <th scope="col">รอบที่ 1</th>
                      <th scope="col">รอบที่ 2</th>
                      <th scope="col">รอบที่ 3</th>
                      <th scope="col">รอบที่ 4</th>
                      <th scope="col">คะแนนรวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboardEntries.map((entry) => (
                      <tr
                        key={entry.player.id}
                        className={`${entry.player.status === "winner" ? "is-winner" : ""} ${entry.roundPoints > 0 ? "is-awarded" : ""
                          }`.trim()}
                        aria-label={`คะแนนสะสมของ ${entry.player.name}`}
                      >
                        <th scope="row">
                          <div className="leaderboard-player-cell">
                            <strong>{entry.player.name}</strong>
                          </div>
                        </th>
                        {entry.roundScores.map((roundScore, roundIndex) => (
                          <td
                            key={`${entry.player.id}-round-${roundIndex + 1}`}
                            className={
                              roundIndex + 1 ===
                                sessionState.completedRoundsInMatch
                                ? "is-current-round"
                                : ""
                            }
                          >
                            {roundScore === null ? (
                              "-"
                            ) : roundScore.challengeBonus > 0 ? (
                              <span className="leaderboard-round-score-value">
                                {roundScore.totalPoints -
                                  roundScore.challengeBonus >
                                  0 ? (
                                  <>
                                    <span>
                                      {roundScore.totalPoints -
                                        roundScore.challengeBonus}
                                    </span>{" "}
                                  </>
                                ) : null}
                                <span className="leaderboard-round-bonus">
                                  +{roundScore.challengeBonus}
                                </span>
                              </span>
                            ) : (
                              roundScore.totalPoints
                            )}
                          </td>
                        ))}
                        <td className="leaderboard-total-cell">
                          <strong>{entry.score}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="action-row">
                <button
                  type="button"
                  className="ghost-button history-action-button"
                  onClick={handleUndo}
                  disabled={!canUndoGameHistory || isSubmittingTurn}
                  aria-label="ย้อนกลับ"
                  title="ย้อนกลับ (Ctrl/Cmd+Z)"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 10h10a5 5 0 0 1 5 5v2" />
                    <polyline points="3 10 7 6" />
                    <polyline points="3 10 7 14" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="ghost-button history-action-button"
                  onClick={handleRedo}
                  disabled={!canRedoGameHistory || isSubmittingTurn}
                  aria-label="ทำซ้ำ"
                  title="ทำซ้ำ (Shift+Ctrl/Cmd+Z)"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 10H11a5 5 0 0 0-5 5v2" />
                    <polyline points="21 10 17 6" />
                    <polyline points="21 10 17 14" />
                  </svg>
                </button>
                <button
                  ref={leaderboardActionButtonRef}
                  type="button"
                  className="primary-button symbol-button"
                  onClick={handleReplaySamePlayers}
                  aria-label={replayButtonLabel}
                  title={replayButtonLabel}
                >
                  <span className="button-copy">{replayButtonCopy}</span>
                </button>
                <button
                  type="button"
                  className="secondary-button symbol-button"
                  onClick={handleResetAll}
                  aria-label="เริ่มใหม่"
                  title="เริ่มใหม่"
                >
                  <span className="button-copy">เริ่มใหม่</span>
                </button>
              </div>
            </section>
          </section>
        )}
    </main>
  );
}

export default App;
