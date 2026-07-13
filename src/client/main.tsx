import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import {
  legalBeerSourcesForNetwork,
  legalBeerSourcesForSaleSelect,
  legalCoalSourcesForNetworkSelect,
  legalResourceSourcesForSelect,
  type SaleBeerSourceSelection,
} from '../common/gameEngine';
import { FACE_AUDIT_AREAS, type FaceAuditArea } from '../common/faceAudit';
import { BOARD_SLOT_REGIONS, type BoardSlotRegion } from '../common/boardSpaces';
import { getActiveIndustries, getActiveLinks } from '../common/selectors';
import { staticConfig } from '../common/staticData';
import type { GameCommand, GameState, IndustryType, PlayerColor, SellStep } from '../common/types';
import { canScout, normalizeScoutCardSelection, scoutCardOptionsForSelect } from './actionOptions';
import {
  buildIndustryOptionsForLocationAndCard,
  buildLocationOptionsForCard,
  buildSlotOptionsForIndustry,
} from './buildSlots';
import {
  industryLiquidationValue,
  merchantDevelopSourceLabel,
  negativeIncomeIndustryOptions,
  resolveMerchantDevelopDecisionReason,
  resolveNegativeIncomeDecisionReason,
} from './decisionOptions';
import { developOptionsForSelect, normalizeDevelopSelections } from './developOptions';
import { doubleRailBeerSourceForSubmit, networkLinkOptionsForSelect } from './networkOptions';
import {
  marketOccupiedCount,
  normalizeResourceSelection,
  optionalSource,
  optionalSources,
  resourceSourcesForBuildSlot,
  resourceOptionsFromSources,
  type ResourceOption,
} from './resourceSources';
import {
  buildActionReason,
  developActionReason,
  loanActionReason,
  networkActionReason,
  passActionReason,
  scoutActionReason,
  sellActionReason,
} from './actionValidation';
import { gameSummariesFromPayload, listedGames, savedSessionLabel, type GameSummary, type ListedGame } from './roomListOptions';
import { hashForGameState, parseGameJoinHash, playerSessionHash, playerSessionUrl } from './sessionLinks';
import { joinGamePayload } from './joinGameOptions';
import { acknowledgedCommandPlayerId, commandGamePayload } from './commandGameOptions';
import {
  faceAuditAreaSummaryLabel,
  faceAuditChecklistIdentityLabel,
  faceAuditChecklistFromPayload,
  faceAuditFieldSummary,
  faceAuditItemsForArea,
  type FaceAuditChecklistView,
} from './faceAuditViewOptions';
import {
  faceAuditAreaCompletionCountsLabel,
  faceAuditAreaReviewTemplateFromPayload,
  faceAuditAreaReviewTemplatePath,
  faceAuditAreaReviewTemplateDownloadLabel,
  faceAuditAreaReviewTemplateFileName,
  buildFaceAuditEvidenceSourceTemplateArtifact,
  faceAuditEvidenceSourceLabel,
  faceAuditEvidenceSourceFromPayload,
  faceAuditEvidenceSourcesFromPayload,
  faceAuditEvidenceSourceTemplateDownloadLabel,
  faceAuditEvidenceSourceTemplateFileName,
  faceAuditEvidenceSourceTemplateLabel,
  faceAuditEvidenceSourceTemplateFromPayload,
  faceAuditEvidenceRefTemplateDownloadLabel,
  faceAuditEvidenceRefTemplateFileName,
  faceAuditEvidenceRefTemplateFromPayload,
  faceAuditEvidenceRefTemplateLabel,
  faceAuditEvidenceRefTemplatePath,
  fillFaceAuditAreaReviewArtifact,
  faceAuditAreaReviewTodoSummaryDownloadLabel,
  faceAuditAreaReviewTodoSummaryFileName,
  faceAuditAreaReviewTodoSummaryFromPayload,
  faceAuditAreaReviewTodoSummaryLabel,
  faceAuditAreaReviewTodoSummaryPath,
  faceAuditLockArtifactFromPayload,
  faceAuditLockArtifactLabel,
  faceAuditLockArtifactValidationFromPayload,
  faceAuditLockArtifactValidationLabel,
  faceAuditLockArtifactVerifyPath,
  faceAuditMergedReviewArtifactFromPayload,
  faceAuditReleaseGatePath,
  faceAuditReviewAreaName,
  faceAuditReviewArtifactRequestOptions,
  faceAuditEvidenceCoverageLabel,
  faceAuditReviewMatchPath,
  faceAuditAreaReviewerInstructionsDownloadLabel,
  faceAuditAreaReviewerInstructionsFileName,
  faceAuditAreaReviewerInstructionsPath,
  faceAuditReviewMergeLabel,
  faceAuditReviewMergePath,
  faceAuditReviewIssueLabel,
  faceAuditReviewerInstructionsDownloadLabel,
  faceAuditReviewerInstructionsFileName,
  faceAuditReviewerInstructionsPath,
  faceAuditReviewerHandoffAreaDownloadLabel,
  faceAuditReviewerHandoffAreaFileName,
  faceAuditReviewerHandoffDownloadLabel,
  faceAuditReviewerHandoffFileName,
  faceAuditReviewerHandoffFromPayload,
  faceAuditReviewerHandoffLabel,
  faceAuditReviewerHandoffPath,
  faceAuditReviewerHandoffResponseFromPayload,
  faceAuditReviewerHandoffResponseLabel,
  faceAuditReviewerHandoffResponsePath,
  faceAuditReviewerHandoffValidationFromPayload,
  faceAuditReviewerHandoffValidationLabel,
  faceAuditReviewerHandoffVerifyPath,
  faceAuditReviewStatusFromPayload,
  faceAuditReviewStatusLabel,
  faceAuditReviewStatusPath,
  faceAuditReviewPlanAreaLabel,
  faceAuditReviewPlanDownloadLabel,
  faceAuditReviewPlanFileName,
  faceAuditReviewPlanFromPayload,
  faceAuditReviewPlanLabel,
  faceAuditReviewPlanPath,
  faceAuditAreaReviewSheetDownloadLabel,
  faceAuditAreaReviewSheetFileName,
  faceAuditAreaReviewSheetPath,
  faceAuditReviewFromSheetFileName,
  faceAuditReviewSheetDownloadLabel,
  faceAuditReviewSheetFileName,
  faceAuditReviewSheetImportDownloadLabel,
  faceAuditReviewSheetImportPath,
  faceAuditReviewSheetPath,
  faceAuditReviewSubmissionLabel,
  faceAuditReviewSubmissionPath,
  faceAuditStaticLockGateFromPayload,
  faceAuditStaticLockGateLabel,
  faceAuditSourceIdsByAreaDownloadLabel,
  faceAuditSourceIdsByAreaFileName,
  faceAuditSourceIdsByAreaFromPayload,
  faceAuditSourceIdsByAreaPayload,
  faceAuditSourceIdsByAreaTemplatePath,
  faceAuditReviewTemplateFromPayload,
  faceAuditReviewTemplateDownloadLabel,
  faceAuditReviewTemplateFileName,
  faceAuditReviewTodoAreaLabel,
  faceAuditReviewTodoDownloadLabel,
  faceAuditReviewTodoFileName,
  faceAuditReviewTodoFromPayload,
  faceAuditReviewTodoLabel,
  faceAuditReviewTodoPath,
  faceAuditReviewTodoSummaryDownloadLabel,
  faceAuditReviewTodoSummaryFileName,
  faceAuditReviewTodoSummaryFromPayload,
  faceAuditReviewTodoSummaryLabel,
  faceAuditReviewTodoSummaryPath,
  faceAuditReviewValidationLabel,
  faceAuditReviewValidationFromPayload,
  type FaceAuditLockArtifactValidationView,
  type FaceAuditAreaReviewTodoSummaryView,
  type FaceAuditAreaReviewFillOptions,
  type FaceAuditEvidenceSourceTemplateFileView,
  type FaceAuditEvidenceRefTemplateView,
  type FaceAuditReviewerHandoffResponseView,
  type FaceAuditReviewerHandoffValidationView,
  type FaceAuditReviewerHandoffView,
  type FaceAuditReviewPlanView,
  type FaceAuditReviewStatusView,
  type FaceAuditStaticLockGateView,
  type FaceAuditReviewSubmissionType,
  type FaceAuditSourceIdsByAreaView,
  type FaceAuditReviewTodoView,
  type FaceAuditReviewValidationView,
} from './faceAuditReviewOptions';
import {
  faceAuditAreaProgress,
  faceAuditItemKey,
  faceAuditProgressCount,
  faceAuditProgressLabel,
  parseFaceAuditProgressArtifact,
  parseFaceAuditReviewArtifactProgress,
  readFaceAuditReviewedKeys,
  serializeFaceAuditProgressArtifact,
  updateFaceAuditReviewedKeys,
  writeFaceAuditReviewedKeys,
} from './faceAuditProgressStore';
import { viewerUpdateFromReply } from './replyViewOptions';
import {
  activePlayerIdForView,
  canSubmitForActivePlayerView,
  handPlayerIdForView,
  normalizedSessionsForView,
  pendingDecisionPlayerIdForView,
  savedSessionJoinViewerUpdate,
  sessionForPlayer,
  sessionNeededForActivePlayerView,
} from './sessionOptions';
import { rememberSessions, sessionsForGame, type PlayerSession } from './playerSessionStore';
import {
  playerHandCardIdsForView,
  playerLabelForView,
  playerTableRowForView,
} from './playerView';
import { createGamePayload, playerNamesForCount } from './createGameOptions';
import {
  addSellStepDraft,
  createSellStepDraft,
  merchantSpacesForSellIndustry,
  merchantSpacesWithTiles,
  normalizeSellStepDrafts,
  sellableIndustriesForPlayer,
  sellableIndustriesForSellStep,
  type SellStepDraft,
} from './sellOptions';
import { gameStatePushOptions } from './gameStatePushOptions';
import { manualJoinViewerUpdate } from './manualJoinViewOptions';
import { serverUrlFromOptions } from './serverUrlOptions';
import './styles.css';

type SocketReply = {
  ok: boolean;
  game?: GameState;
  session?: PlayerSession;
  sessions?: PlayerSession[];
  errors?: string[];
};

type ReplyHandlingOptions = {
  preserveViewerWithoutSession?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hexFromArrayBuffer(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

const serverUrl = serverUrlFromOptions({
  isDev: import.meta.env.DEV,
  location: window.location,
  configuredServerUrl: import.meta.env.VITE_BRASS_SERVER_URL,
});
const showRulesDataFaceAudit = import.meta.env.VITE_SHOW_RULES_DATA_FACE_AUDIT === 'true';
const ironSourceAnchorLocationId = 'birmingham';
const officialImagesBaseUrl = `${serverUrl}/official-game-images`;
const assetKeySeparator = '\u001f';

type OfficialImageManifestEntry = {
  kind: string;
  id: string;
  label?: string;
  playerColor?: PlayerColor;
  output: string;
  side?: string;
  faceName?: string;
};

type OfficialImageManifest = {
  entries?: OfficialImageManifestEntry[];
};

type OfficialAssetStatus = 'loading' | 'ready' | 'unavailable';

type OfficialAssets = {
  status: OfficialAssetStatus;
  entriesByKey: Map<string, OfficialImageManifestEntry>;
  error?: string;
};

function isHiddenCardId(cardId: string): boolean {
  return cardId.startsWith('hidden-card-');
}

function officialAssetKey(kind: string, id: string, playerColor?: PlayerColor): string {
  return playerColor
    ? `${kind}${assetKeySeparator}${id}${assetKeySeparator}${playerColor}`
    : `${kind}${assetKeySeparator}${id}`;
}

function officialOutputPath(output: string): string {
  return output
    .replace(/\\/g, '/')
    .replace(/^mods\/OfficialGameImages\//, '');
}

function officialOutputUrl(output: string): string {
  return `${officialImagesBaseUrl}/${officialOutputPath(output)}`;
}

function officialAssetUrl(assets: OfficialAssets, kind: string, id: string, playerColor?: PlayerColor): string | undefined {
  const entry = playerColor
    ? assets.entriesByKey.get(officialAssetKey(kind, id, playerColor)) ?? assets.entriesByKey.get(officialAssetKey(kind, id))
    : assets.entriesByKey.get(officialAssetKey(kind, id));
  return entry ? officialOutputUrl(entry.output) : undefined;
}

function officialRegularCardId(cardId: string): string {
  return cardId.replace(/^p[234]-/, 'p4-');
}

function officialCardUrl(assets: OfficialAssets, cardId: string): string | undefined {
  if (isHiddenCardId(cardId)) {
    return officialAssetUrl(assets, 'source.cardBack', 'regular-card-back');
  }
  const card = staticConfig.cardSpecs[cardId];
  if (card?.type === 'wild_location' || card?.type === 'wild_industry') {
    return officialAssetUrl(assets, 'card.wildAuditItem', cardId);
  }
  return officialAssetUrl(assets, 'card.regularAuditItem', cardId)
    ?? officialAssetUrl(assets, 'card.regularAuditItem', officialRegularCardId(cardId));
}

function officialIndustryTileUrl(assets: OfficialAssets, specId: string, flipped: boolean, playerColor?: PlayerColor): string | undefined {
  return officialAssetUrl(assets, flipped ? 'industry.auditItemBack' : 'industry.auditItemFront', specId, playerColor);
}

function officialMerchantTileUrl(assets: OfficialAssets, merchantTileInstanceId?: string): string | undefined {
  const specId = merchantTileInstanceId?.replace(/-\d+$/, '');
  return specId ? officialAssetUrl(assets, 'merchant.auditItem', specId) : undefined;
}

function useOfficialAssets(): OfficialAssets {
  const [entries, setEntries] = useState<OfficialImageManifestEntry[]>([]);
  const [status, setStatus] = useState<OfficialAssetStatus>('loading');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    async function loadManifest() {
      try {
        const response = await fetch(`${officialImagesBaseUrl}/manifest.json`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const manifest = await response.json() as OfficialImageManifest;
        if (!cancelled) {
          setEntries(Array.isArray(manifest.entries) ? manifest.entries : []);
          setStatus('ready');
          setError(undefined);
        }
      } catch (loadError) {
        if (!cancelled) {
          setEntries([]);
          setStatus('unavailable');
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      }
    }
    void loadManifest();
    return () => {
      cancelled = true;
    };
  }, []);

  const entriesByKey = useMemo(() => {
    return new Map(entries.map((entry) => [officialAssetKey(entry.kind, entry.id, entry.playerColor), entry]));
  }, [entries]);

  return { status, entriesByKey, error };
}

function assetStatusLabel(assets: OfficialAssets): string {
  if (assets.status === 'ready') {
    return '公式画像 読み込み済み';
  }
  if (assets.status === 'loading') {
    return '公式画像 読み込み中';
  }
  return `公式画像 未接続${assets.error ? ` (${assets.error})` : ''}`;
}

const visibleIdMaxLength = 18;

function abbreviatedId(id: string, maxLength = visibleIdMaxLength): string {
  if (id.length <= maxLength) {
    return id;
  }
  const visibleLength = Math.max(4, maxLength - 3);
  const headLength = Math.ceil(visibleLength / 2);
  const tailLength = visibleLength - headLength;
  return `${id.slice(0, headLength)}...${id.slice(-tailLength)}`;
}

function labelWithAbbreviatedId(label: string, id: string): string {
  const abbreviated = abbreviatedId(id);
  return abbreviated === id ? label : label.replace(id, abbreviated);
}

function ShortId({ id, className }: { id: string; className?: string }) {
  const abbreviated = abbreviatedId(id);
  return (
    <abbr className={className ? `${className} short-id` : 'short-id'} title={abbreviated === id ? undefined : id}>
      {abbreviated}
    </abbr>
  );
}

function ResourceSourceSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ResourceOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const optionsKey = options.map((option) => option.value).join('\u001f');

  useEffect(() => {
    const normalized = normalizeResourceSelection(value, options);
    if (normalized !== value) {
      onChange(normalized);
    }
  }, [optionsKey, value]);

  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Auto</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function App() {
  const socket = useMemo<Socket>(() => io(serverUrl, { autoConnect: true }), []);
  const officialAssets = useOfficialAssets();
  const [game, setGame] = useState<GameState | undefined>();
  const [errors, setErrors] = useState<string[]>([]);
  const [knownSessions, setKnownSessions] = useState<PlayerSession[]>([]);
  const [autoFollowActivePlayer, setAutoFollowActivePlayer] = useState(true);
  const [viewerPlayerId, setViewerPlayerId] = useState<string | undefined>();

  useEffect(() => {
    socket.on('game:state', (nextGame: GameState) => {
      const pushOptions = gameStatePushOptions(nextGame.id, window.location.hash, sessionsForGame);
      if (!pushOptions.ok) {
        setErrors([pushOptions.error]);
        return;
      }
      setGame(nextGame);
      window.location.hash = pushOptions.hash;
      setKnownSessions(pushOptions.sessions);
    });
    const hashJoin = parseGameJoinHash(window.location.hash);
    if (hashJoin) {
      const hashSession = hashJoin.playerId && hashJoin.sessionToken
        ? { playerId: hashJoin.playerId, token: hashJoin.sessionToken }
        : undefined;
      const storedSessions = hashSession
        ? rememberSessions(hashJoin.gameId, [hashSession])
        : sessionsForGame(hashJoin.gameId);
      setKnownSessions(storedSessions);
      const firstSession = hashSession ?? storedSessions[0];
      const joinResult = joinGamePayload(hashJoin.gameId, firstSession?.playerId, firstSession?.token);
      if (joinResult.ok) {
        socket.emit('game:join', joinResult.payload, handleReply);
      } else {
        setErrors([joinResult.error]);
      }
    }
    return () => {
      socket.off('game:state');
    };
  }, [socket]);

  function handleReply(reply: SocketReply, options: ReplyHandlingOptions = {}) {
    if (!reply.ok) {
      setErrors(reply.errors ?? ['Unknown error']);
      return;
    }
    setErrors([]);
    if (reply.game) {
      const sessionsToStore = reply.sessions ?? (reply.session ? [reply.session] : []);
      if (reply.sessions && reply.sessions.length > 0) {
        setAutoFollowActivePlayer(true);
      }
      if (reply.session && !reply.sessions) {
        window.location.hash = playerSessionHash(reply.game.id, reply.session);
      } else {
        window.location.hash = hashForGameState(reply.game.id, window.location.hash);
      }
      const viewerUpdate = viewerUpdateFromReply(reply, {
        preserveViewerWithoutSession: options.preserveViewerWithoutSession,
      });
      if (viewerUpdate.kind === 'player') {
        setViewerPlayerId(viewerUpdate.playerId);
      } else if (viewerUpdate.kind === 'observer') {
        setViewerPlayerId(undefined);
      }
      setKnownSessions(sessionsToStore.length > 0
        ? rememberSessions(reply.game.id, sessionsToStore)
        : sessionsForGame(reply.game.id));
      setGame(reply.game);
    }
  }

  useEffect(() => {
    if (!game) {
      return;
    }
    const session = sessionNeededForActivePlayerView(game, knownSessions, { autoFollowActivePlayer });
    if (!session) {
      return;
    }
    const result = joinGamePayload(game.id, session.playerId, session.token);
    if (!result.ok) {
      setErrors([result.error]);
      return;
    }
    socket.emit('game:join', result.payload, (reply: SocketReply) => {
      handleReply(reply, { preserveViewerWithoutSession: true });
    });
  }, [autoFollowActivePlayer, game, knownSessions, socket]);

  function sendCommand(command: GameCommand) {
    if (!game) {
      return;
    }
    const session = sessionForPlayer(knownSessions, command.playerId);
    if (!session) {
      setErrors([`No saved session token for ${command.playerId}`]);
      return;
    }
    const result = commandGamePayload(game.id, command, session.token);
    if (!result.ok) {
      setErrors([result.error]);
      return;
    }
    socket.emit('game:command', result.payload, (reply: SocketReply) => {
      const nextViewerPlayerId = acknowledgedCommandPlayerId(reply, command.playerId);
      if (nextViewerPlayerId) {
        setAutoFollowActivePlayer(true);
        setViewerPlayerId(nextViewerPlayerId);
      }
      handleReply(reply, { preserveViewerWithoutSession: true });
    });
  }

  function joinSession(session: PlayerSession) {
    if (!game) {
      return;
    }
    const result = joinGamePayload(game.id, session.playerId, session.token);
    if (!result.ok) {
      setErrors([result.error]);
      return;
    }
    socket.emit('game:join', result.payload, (reply: SocketReply) => {
      handleReply(reply);
      const viewerUpdate = savedSessionJoinViewerUpdate(reply, session);
      if (viewerUpdate.apply) {
        setAutoFollowActivePlayer(viewerUpdate.autoFollowActivePlayer);
        setViewerPlayerId(viewerUpdate.playerId);
      }
    });
  }

  function selectManualViewer(playerId?: string) {
    setAutoFollowActivePlayer(false);
    setViewerPlayerId(playerId);
  }

  function leaveRoom() {
    socket.timeout(3000).emit('game:leave', {}, (error: Error | null, reply: SocketReply) => {
      if (error) {
        setErrors([error.message]);
        return;
      }
      if (!reply.ok) {
        setErrors(reply.errors ?? ['Unknown error']);
        return;
      }
      setErrors([]);
      setGame(undefined);
      setKnownSessions([]);
      setAutoFollowActivePlayer(true);
      setViewerPlayerId(undefined);
      window.location.hash = '';
    });
  }

  return (
    <main className="game-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Online table</p>
          <h1>Brass: Birmingham</h1>
        </div>
        <div className="header-pills" aria-label="table status">
          <span>{game ? <>Game <ShortId id={game.id} /></> : 'Lobby'}</span>
          {/* <span>{assetStatusLabel(officialAssets)}</span> */}
        </div>
      </header>
      {errors.length > 0 && (
        <div className="error-panel" role="alert">
          <h2>Errors</h2>
          {errors.map((error) => <div key={error}>{error}</div>)}
        </div>
      )}
      {showRulesDataFaceAudit && (
        <details className="audit-drawer">
          <summary>Rules Data Face Audit</summary>
          <FaceAuditPanel />
        </details>
      )}
      {game
        ? (
          <GameView
            game={game}
            knownSessions={knownSessions}
            viewerPlayerId={viewerPlayerId}
            sendCommand={sendCommand}
            joinSession={joinSession}
            leaveRoom={leaveRoom}
            assets={officialAssets}
          />
        )
        : (
          <ConnectionPanel
            socket={socket}
            onReply={handleReply}
            onManualJoin={selectManualViewer}
            assets={officialAssets}
          />
        )}
    </main>
  );
}

function reviewArtifactsFromPayload(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as { artifacts?: unknown }).artifacts)
  ) {
    return (value as { artifacts: unknown[] }).artifacts;
  }
  return undefined;
}

function downloadTextArtifact(fileName: string, text: string, contentType: string): void {
  const blob = new Blob([text], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}

function FaceAuditPanel() {
  const [checklist, setChecklist] = useState<FaceAuditChecklistView>({ areas: [], items: [] });
  const [reviewedItemKeys, setReviewedItemKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [progressArtifactText, setProgressArtifactText] = useState('');
  const [progressArtifactMessage, setProgressArtifactMessage] = useState<string | undefined>();
  const [reviewArtifactText, setReviewArtifactText] = useState('');
  const [reviewArtifactMessage, setReviewArtifactMessage] = useState<string | undefined>();
  const [reviewArtifactLoading, setReviewArtifactLoading] = useState(false);
  const [reviewValidation, setReviewValidation] = useState<FaceAuditReviewValidationView | undefined>();
  const [reviewStatusReport, setReviewStatusReport] = useState<FaceAuditReviewStatusView | undefined>();
  const [reviewTodoReport, setReviewTodoReport] = useState<FaceAuditReviewTodoView | undefined>();
  const [reviewAreaTodoSummaryReport, setReviewAreaTodoSummaryReport] =
    useState<FaceAuditAreaReviewTodoSummaryView | undefined>();
  const [reviewPlanReport, setReviewPlanReport] = useState<FaceAuditReviewPlanView | undefined>();
  const [reviewHandoffReport, setReviewHandoffReport] = useState<FaceAuditReviewerHandoffView | undefined>();
  const [evidenceRefTemplate, setEvidenceRefTemplate] = useState<FaceAuditEvidenceRefTemplateView | undefined>();
  const [reviewHandoffValidation, setReviewHandoffValidation] =
    useState<FaceAuditReviewerHandoffValidationView | undefined>();
  const [reviewHandoffResponse, setReviewHandoffResponse] =
    useState<FaceAuditReviewerHandoffResponseView | undefined>();
  const [selectedReviewArea, setSelectedReviewArea] = useState('regularCards');
  const [mergeArtifactText, setMergeArtifactText] = useState('');
  const [reviewSheetImportText, setReviewSheetImportText] = useState('');
  const [evidenceSourceArtifactText, setEvidenceSourceArtifactText] = useState('');
  const [selectedEvidenceSourceArtifactId, setSelectedEvidenceSourceArtifactId] = useState('');
  const [reviewMatchSourceIdsByArea, setReviewMatchSourceIdsByArea] =
    useState<FaceAuditSourceIdsByAreaView>({});
  const [evidenceSourceArtifactMessage, setEvidenceSourceArtifactMessage] = useState<string | undefined>();
  const [evidenceSourceArtifactLoading, setEvidenceSourceArtifactLoading] = useState(false);
  const [reviewFillReviewer, setReviewFillReviewer] = useState('');
  const [reviewFillReviewedAt, setReviewFillReviewedAt] = useState(() => new Date().toISOString());
  const [reviewFillEvidenceSourceId, setReviewFillEvidenceSourceId] = useState('official-set');
  const [reviewFillEvidenceSourceLabel, setReviewFillEvidenceSourceLabel] = useState('Official component reference');
  const [reviewFillEvidenceSourceType, setReviewFillEvidenceSourceType] =
    useState<FaceAuditAreaReviewFillOptions['evidenceSourceType']>('official_physical_component');
  const [reviewFillEvidenceSourceCitation, setReviewFillEvidenceSourceCitation] = useState('');
  const [reviewFillEvidenceSourceLocator, setReviewFillEvidenceSourceLocator] = useState('');
  const [reviewFillEvidenceSourceContentHash, setReviewFillEvidenceSourceContentHash] = useState('');
  const [reviewFillStatus, setReviewFillStatus] =
    useState<FaceAuditAreaReviewFillOptions['reviewStatus']>('matches_official_face');
  const [reviewFillEvidenceRefScope, setReviewFillEvidenceRefScope] =
    useState<NonNullable<FaceAuditAreaReviewFillOptions['evidenceRefScope']>>('area');
  const [reviewFillItemNotes, setReviewFillItemNotes] = useState('');
  const [lockArtifactText, setLockArtifactText] = useState('');
  const [lockArtifactMessage, setLockArtifactMessage] = useState<string | undefined>();
  const [lockArtifactLoading, setLockArtifactLoading] = useState(false);
  const [lockArtifactValidation, setLockArtifactValidation] = useState<FaceAuditLockArtifactValidationView | undefined>();
  const [releaseGate, setReleaseGate] = useState<FaceAuditStaticLockGateView | undefined>();
  const evidenceSourceArtifactSources = useMemo(() => {
    if (evidenceSourceArtifactText.trim().length === 0) {
      return [];
    }
    try {
      return faceAuditEvidenceSourcesFromPayload(JSON.parse(evidenceSourceArtifactText) as unknown) ?? [];
    } catch {
      return [];
    }
  }, [evidenceSourceArtifactText]);
  const reviewMatchFallbackSourceId = evidenceSourceArtifactSources.find((source) =>
    source.id === selectedEvidenceSourceArtifactId)?.id ??
    evidenceSourceArtifactSources[0]?.id ??
    reviewFillEvidenceSourceId;
  const reviewMatchAreaSourceOptions = evidenceSourceArtifactSources.length > 0
    ? evidenceSourceArtifactSources
    : reviewFillEvidenceSourceId.trim().length === 0
      ? []
      : [{
        id: reviewFillEvidenceSourceId.trim(),
        label: reviewFillEvidenceSourceLabel,
        sourceType: reviewFillEvidenceSourceType,
        citation: reviewFillEvidenceSourceCitation,
        locator: reviewFillEvidenceSourceLocator.trim() || undefined,
        contentHash: reviewFillEvidenceSourceContentHash.trim() || undefined,
        notes: '',
      }];
  const totalItems = checklist.items.length;
  const progress = faceAuditProgressCount(checklist, reviewedItemKeys);
  const reviewedItemKeySet = useMemo(() => new Set(reviewedItemKeys), [reviewedItemKeys]);
  const visibleReviewIssues = reviewValidation?.issues.slice(0, 12) ?? [];
  const visibleReviewTodoIssues = reviewTodoReport?.issues.slice(0, 12) ?? [];
  const visibleReviewAreaTodoSummaryIssues = reviewAreaTodoSummaryReport?.issues.slice(0, 12) ?? [];
  const visibleReviewPlanIssues = reviewPlanReport?.issues.slice(0, 12) ?? [];
  const visibleReviewHandoffIssues = reviewHandoffReport?.issues.slice(0, 12) ?? [];
  const visibleReviewHandoffValidationIssues = reviewHandoffValidation?.issues.slice(0, 12) ?? [];
  const visibleReviewHandoffResponseIssues = reviewHandoffResponse?.issues.slice(0, 12) ?? [];
  const visibleEvidenceRefs = evidenceRefTemplate?.evidenceRefs.slice(0, 12) ?? [];
  const visibleLockArtifactIssues = lockArtifactValidation?.issues.slice(0, 12) ?? [];
  const visibleReleaseGateIssues = releaseGate?.issues.slice(0, 12) ?? [];

  async function loadFaceAuditChecklist() {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`${serverUrl}/api/face-audit-checklist`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const nextChecklist = faceAuditChecklistFromPayload(await response.json());
      setChecklist(nextChecklist);
      const storedReviewedItemKeys = readFaceAuditReviewedKeys(nextChecklist);
      setReviewedItemKeys(storedReviewedItemKeys);
      setProgressArtifactText(serializeFaceAuditProgressArtifact(nextChecklist, storedReviewedItemKeys));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFaceAuditChecklist();
  }, []);

  useEffect(() => {
    if (
      selectedEvidenceSourceArtifactId &&
      evidenceSourceArtifactSources.some((source) => source.id === selectedEvidenceSourceArtifactId)
    ) {
      return;
    }
    const nextSourceId = evidenceSourceArtifactSources[0]?.id ?? '';
    if (selectedEvidenceSourceArtifactId !== nextSourceId) {
      setSelectedEvidenceSourceArtifactId(nextSourceId);
    }
  }, [evidenceSourceArtifactSources, selectedEvidenceSourceArtifactId]);

  function updateReviewedItem(item: FaceAuditChecklistView['items'][number], reviewed: boolean) {
    const nextReviewedItemKeys = updateFaceAuditReviewedKeys(checklist, reviewedItemKeys, item, reviewed);
    setReviewedItemKeys(writeFaceAuditReviewedKeys(checklist, nextReviewedItemKeys));
    setProgressArtifactMessage(undefined);
  }

  function clearReviewedItems() {
    setReviewedItemKeys(writeFaceAuditReviewedKeys(checklist, []));
    setProgressArtifactMessage(undefined);
  }

  function exportReviewedItems() {
    setProgressArtifactText(serializeFaceAuditProgressArtifact(checklist, reviewedItemKeys));
    setProgressArtifactMessage('Progress artifact exported from current reviewed items.');
  }

  function importReviewedItems() {
    const result = parseFaceAuditProgressArtifact(checklist, progressArtifactText);
    if (!result.ok) {
      setProgressArtifactMessage(result.error);
      return;
    }
    const nextReviewedItemKeys = writeFaceAuditReviewedKeys(checklist, result.reviewedItemKeys);
    setReviewedItemKeys(nextReviewedItemKeys);
    setProgressArtifactText(serializeFaceAuditProgressArtifact(checklist, nextReviewedItemKeys));
    setProgressArtifactMessage(`Progress artifact imported; ignored ${result.ignoredItemKeyCount} unknown item keys.`);
  }

  function importReviewArtifactProgress() {
    const result = parseFaceAuditReviewArtifactProgress(checklist, reviewArtifactText);
    if (!result.ok) {
      setReviewArtifactMessage(result.error);
      return;
    }
    const nextReviewedItemKeys = writeFaceAuditReviewedKeys(checklist, result.reviewedItemKeys);
    setReviewedItemKeys(nextReviewedItemKeys);
    setProgressArtifactText(serializeFaceAuditProgressArtifact(checklist, nextReviewedItemKeys));
    setProgressArtifactMessage(
      `Review artifact progress imported; ignored ${result.ignoredItemKeyCount} unknown reviewed item keys.`,
    );
    setReviewArtifactMessage(
      `Imported ${nextReviewedItemKeys.length} reviewed checklist item(s) from the loaded review artifact.`,
    );
  }

  async function loadFaceAuditReviewTemplate() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const response = await fetch(`${serverUrl}/api/face-audit-review-template`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const template = faceAuditReviewTemplateFromPayload(payload);
      if (!template) {
        throw new Error('Invalid face-audit review template payload');
      }
      setReviewArtifactText(JSON.stringify(payload.faceAuditReview, null, 2));
      setReviewArtifactMessage(
        `Loaded review template ${template.checklistFingerprint} with ${template.checklistItemCount} items.`,
      );
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function downloadFaceAuditReviewTemplate() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const response = await fetch(`${serverUrl}/api/face-audit-review-template`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as unknown;
      const template = faceAuditReviewTemplateFromPayload(payload);
      const templateArtifact = isRecord(payload) && isRecord(payload.faceAuditReview)
        ? payload.faceAuditReview
        : undefined;
      if (!template || templateArtifact === undefined) {
        throw new Error('Invalid face-audit review template payload');
      }
      const artifactText = `${JSON.stringify(templateArtifact, null, 2)}\n`;
      setReviewArtifactText(artifactText.trimEnd());
      downloadTextArtifact(
        faceAuditReviewTemplateFileName(),
        artifactText,
        'application/json',
      );
      setReviewArtifactMessage(faceAuditReviewTemplateDownloadLabel(template));
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function loadFaceAuditAreaReviewTemplate() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const area = faceAuditReviewAreaName(selectedReviewArea);
      if (!area) {
        throw new Error('Select a valid face-audit area');
      }
      const response = await fetch(`${serverUrl}${faceAuditAreaReviewTemplatePath(area)}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const template = faceAuditAreaReviewTemplateFromPayload(payload);
      if (!template) {
        throw new Error('Invalid face-audit area review template payload');
      }
      setReviewArtifactText(JSON.stringify(payload.faceAuditAreaReview, null, 2));
      setReviewArtifactMessage(
        `Loaded ${template.area} review template ${template.checklistFingerprint} with ${template.areaItemCount} items.`,
      );
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function downloadFaceAuditAreaReviewTemplate() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const area = faceAuditReviewAreaName(selectedReviewArea);
      if (!area) {
        throw new Error('Select a valid face-audit area');
      }
      const response = await fetch(`${serverUrl}${faceAuditAreaReviewTemplatePath(area)}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as unknown;
      const template = faceAuditAreaReviewTemplateFromPayload(payload);
      const templateArtifact = isRecord(payload) && isRecord(payload.faceAuditAreaReview)
        ? payload.faceAuditAreaReview
        : undefined;
      if (!template || templateArtifact === undefined) {
        throw new Error('Invalid face-audit area review template payload');
      }
      const artifactText = `${JSON.stringify(templateArtifact, null, 2)}\n`;
      setReviewArtifactText(artifactText.trimEnd());
      downloadTextArtifact(
        faceAuditAreaReviewTemplateFileName(area),
        artifactText,
        'application/json',
      );
      setReviewArtifactMessage(faceAuditAreaReviewTemplateDownloadLabel(template));
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function mergeFaceAuditReviewArtifacts() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      let artifactPayload: unknown;
      try {
        artifactPayload = JSON.parse(mergeArtifactText) as unknown;
      } catch {
        throw new Error('Merge artifact input must be valid JSON');
      }
      const response = await fetch(`${serverUrl}${faceAuditReviewMergePath()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(artifactPayload),
      });
      const payload = await response.json();
      const validation = faceAuditReviewValidationFromPayload(payload);
      setReviewValidation(validation);
      if (response.ok) {
        const mergedReview = faceAuditMergedReviewArtifactFromPayload(payload);
        if (!mergedReview) {
          throw new Error('Invalid face-audit review merge payload');
        }
        setReviewArtifactText(JSON.stringify(mergedReview, null, 2));
        setReviewArtifactMessage(
          `Merged review artifact. ${faceAuditReviewValidationLabel(validation)}`,
        );
        return;
      }
      setReviewArtifactMessage(faceAuditReviewMergeLabel(validation));
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function summarizeFaceAuditReviewArtifacts() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const response = await fetch(`${serverUrl}${faceAuditReviewStatusPath()}`, {
        ...faceAuditReviewArtifactRequestOptions(mergeArtifactText, 'Review status'),
      });
      const status = faceAuditReviewStatusFromPayload(await response.json());
      setReviewStatusReport(status);
      setReviewArtifactMessage(faceAuditReviewStatusLabel(status));
      if (!response.ok && status.issueCount === 0) {
        setReviewArtifactMessage(`Review status request failed with HTTP ${response.status}`);
      }
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function summarizeFaceAuditReviewTodoArtifacts() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewAreaTodoSummaryReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const response = await fetch(`${serverUrl}${faceAuditReviewTodoPath()}`, {
        ...faceAuditReviewArtifactRequestOptions(mergeArtifactText, 'Review todo'),
      });
      const todo = faceAuditReviewTodoFromPayload(await response.json());
      setReviewTodoReport(todo);
      setReviewArtifactMessage(faceAuditReviewTodoLabel(todo));
      if (!response.ok && todo.issueCount === 0) {
        setReviewArtifactMessage(`Review todo request failed with HTTP ${response.status}`);
      }
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function downloadFaceAuditReviewTodoArtifact() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewAreaTodoSummaryReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const response = await fetch(`${serverUrl}${faceAuditReviewTodoPath()}`, {
        ...faceAuditReviewArtifactRequestOptions(mergeArtifactText, 'Review todo'),
      });
      const payload = await response.json() as unknown;
      const todo = faceAuditReviewTodoFromPayload(payload);
      setReviewTodoReport(todo);
      if (response.ok) {
        const todoArtifact = isRecord(payload) && isRecord(payload.faceAuditReviewTodo)
          ? payload.faceAuditReviewTodo
          : undefined;
        if (!todoArtifact) {
          throw new Error('Invalid face-audit review todo payload');
        }
        downloadTextArtifact(
          faceAuditReviewTodoFileName(),
          `${JSON.stringify(todoArtifact, null, 2)}\n`,
          'application/json',
        );
        setReviewArtifactMessage(
          `${faceAuditReviewTodoDownloadLabel(todo)}. ${faceAuditReviewTodoLabel(todo)}`,
        );
        return;
      }
      setReviewArtifactMessage(faceAuditReviewTodoLabel(todo));
      if (todo.issueCount === 0) {
        setReviewArtifactMessage(`Review todo request failed with HTTP ${response.status}`);
      }
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function downloadFaceAuditReviewTodoSummaryArtifact() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewAreaTodoSummaryReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const response = await fetch(`${serverUrl}${faceAuditReviewTodoSummaryPath()}`, {
        ...faceAuditReviewArtifactRequestOptions(mergeArtifactText, 'Review todo summary'),
      });
      const payload = await response.json() as unknown;
      const summary = faceAuditReviewTodoSummaryFromPayload(payload);
      if (response.ok) {
        const summaryArtifact = isRecord(payload) && isRecord(payload.faceAuditReviewTodoSummary)
          ? payload.faceAuditReviewTodoSummary
          : undefined;
        if (!summaryArtifact) {
          throw new Error('Invalid face-audit review todo summary payload');
        }
        downloadTextArtifact(
          faceAuditReviewTodoSummaryFileName(),
          `${JSON.stringify(summaryArtifact, null, 2)}\n`,
          'application/json',
        );
        setReviewArtifactMessage(
          `${faceAuditReviewTodoSummaryDownloadLabel(summary)}. ${faceAuditReviewTodoSummaryLabel(summary)}`,
        );
        return;
      }
      setReviewArtifactMessage(faceAuditReviewTodoSummaryLabel(summary));
      if (summary.issueCount === 0) {
        setReviewArtifactMessage(`Review todo summary request failed with HTTP ${response.status}`);
      }
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function summarizeFaceAuditAreaReviewTodoArtifacts() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewAreaTodoSummaryReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const area = faceAuditReviewAreaName(selectedReviewArea);
      if (!area) {
        throw new Error('Select a valid face-audit area');
      }
      const response = await fetch(`${serverUrl}${faceAuditAreaReviewTodoSummaryPath(area)}`, {
        ...faceAuditReviewArtifactRequestOptions(mergeArtifactText, 'Area todo summary'),
      });
      const summary = faceAuditAreaReviewTodoSummaryFromPayload(await response.json());
      setReviewAreaTodoSummaryReport(summary);
      setReviewArtifactMessage(faceAuditAreaReviewTodoSummaryLabel(summary));
      if (!response.ok && summary.issueCount === 0) {
        setReviewArtifactMessage(`Area todo summary request failed with HTTP ${response.status}`);
      }
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function downloadFaceAuditAreaReviewTodoSummaryArtifact() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewAreaTodoSummaryReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const area = faceAuditReviewAreaName(selectedReviewArea);
      if (!area) {
        throw new Error('Select a valid face-audit area');
      }
      const response = await fetch(`${serverUrl}${faceAuditAreaReviewTodoSummaryPath(area)}`, {
        ...faceAuditReviewArtifactRequestOptions(mergeArtifactText, 'Area todo summary'),
      });
      const payload = await response.json() as unknown;
      const summary = faceAuditAreaReviewTodoSummaryFromPayload(payload);
      setReviewAreaTodoSummaryReport(summary);
      if (response.ok) {
        const summaryArtifact = isRecord(payload) && isRecord(payload.faceAuditAreaReviewTodoSummary)
          ? payload.faceAuditAreaReviewTodoSummary
          : undefined;
        if (!summaryArtifact) {
          throw new Error('Invalid face-audit area todo summary payload');
        }
        downloadTextArtifact(
          faceAuditAreaReviewTodoSummaryFileName(area),
          `${JSON.stringify(summaryArtifact, null, 2)}\n`,
          'application/json',
        );
        setReviewArtifactMessage(
          `${faceAuditAreaReviewTodoSummaryDownloadLabel(summary)}. ${faceAuditAreaReviewTodoSummaryLabel(summary)}`,
        );
        return;
      }
      setReviewArtifactMessage(faceAuditAreaReviewTodoSummaryLabel(summary));
      if (summary.issueCount === 0) {
        setReviewArtifactMessage(`Area todo summary request failed with HTTP ${response.status}`);
      }
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function buildFaceAuditReviewPlanArtifacts() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewAreaTodoSummaryReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const response = await fetch(`${serverUrl}${faceAuditReviewPlanPath()}`, {
        ...faceAuditReviewArtifactRequestOptions(mergeArtifactText, 'Review plan'),
      });
      const plan = faceAuditReviewPlanFromPayload(await response.json());
      setReviewPlanReport(plan);
      setReviewArtifactMessage(faceAuditReviewPlanLabel(plan));
      if (!response.ok && plan.issueCount === 0) {
        setReviewArtifactMessage(`Review plan request failed with HTTP ${response.status}`);
      }
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function downloadFaceAuditReviewPlanArtifact() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewAreaTodoSummaryReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const response = await fetch(`${serverUrl}${faceAuditReviewPlanPath()}`, {
        ...faceAuditReviewArtifactRequestOptions(mergeArtifactText, 'Review plan'),
      });
      const payload = await response.json() as unknown;
      const plan = faceAuditReviewPlanFromPayload(payload);
      setReviewPlanReport(plan);
      if (response.ok) {
        const planArtifact = isRecord(payload) && isRecord(payload.faceAuditReviewPlan)
          ? payload.faceAuditReviewPlan
          : undefined;
        if (!planArtifact) {
          throw new Error('Invalid face-audit review plan payload');
        }
        downloadTextArtifact(
          faceAuditReviewPlanFileName(),
          `${JSON.stringify(planArtifact, null, 2)}\n`,
          'application/json',
        );
        setReviewArtifactMessage(
          `${faceAuditReviewPlanDownloadLabel(plan)}. ${faceAuditReviewPlanLabel(plan)}`,
        );
        return;
      }
      setReviewArtifactMessage(faceAuditReviewPlanLabel(plan));
      if (plan.issueCount === 0) {
        setReviewArtifactMessage(`Review plan request failed with HTTP ${response.status}`);
      }
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function downloadFaceAuditReviewSheetArtifacts() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const response = await fetch(`${serverUrl}${faceAuditReviewSheetPath()}`, {
        ...faceAuditReviewArtifactRequestOptions(mergeArtifactText, 'Review sheet'),
      });
      if (!response.ok) {
        throw new Error(`Review sheet request failed with HTTP ${response.status}`);
      }
      const text = await response.text();
      downloadTextArtifact(
        faceAuditReviewSheetFileName(),
        text,
        response.headers.get('content-type') ?? 'text/tab-separated-values',
      );
      setReviewArtifactMessage(faceAuditReviewSheetDownloadLabel(
        response.headers.get('x-face-audit-row-count'),
        response.headers.get('x-face-audit-review-fingerprint'),
      ));
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function downloadFaceAuditAreaReviewSheetArtifact() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const area = faceAuditReviewAreaName(selectedReviewArea);
      if (!area) {
        throw new Error('Select a valid face-audit area');
      }
      const response = await fetch(`${serverUrl}${faceAuditAreaReviewSheetPath(area)}`, {
        ...faceAuditReviewArtifactRequestOptions(mergeArtifactText, 'Area review sheet'),
      });
      if (!response.ok) {
        throw new Error(`Area review sheet request failed with HTTP ${response.status}`);
      }
      const text = await response.text();
      downloadTextArtifact(
        faceAuditAreaReviewSheetFileName(area),
        text,
        response.headers.get('content-type') ?? 'text/tab-separated-values',
      );
      setReviewArtifactMessage(faceAuditAreaReviewSheetDownloadLabel(
        area,
        response.headers.get('x-face-audit-row-count'),
        response.headers.get('x-face-audit-review-fingerprint'),
      ));
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function applyFaceAuditReviewSheetArtifacts() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      let artifactPayload: unknown;
      try {
        artifactPayload = JSON.parse(mergeArtifactText) as unknown;
      } catch {
        throw new Error('Review sheet import artifact input must be valid JSON');
      }
      if (reviewSheetImportText.trim().length === 0) {
        throw new Error('Review sheet import TSV is required');
      }
      const response = await fetch(`${serverUrl}${faceAuditReviewSheetImportPath()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          artifacts: artifactPayload,
          reviewSheetTsv: reviewSheetImportText,
        }),
      });
      const payload = await response.json() as unknown;
      const report = isRecord(payload) && isRecord(payload.faceAuditReviewSheetImport)
        ? payload.faceAuditReviewSheetImport
        : undefined;
      if (!response.ok) {
        const issueCount = typeof report?.issueCount === 'number' ? report.issueCount : 0;
        throw new Error(`Review sheet import failed with ${issueCount} issue(s)`);
      }
      const review = isRecord(payload) && isRecord(payload.faceAuditReview)
        ? payload.faceAuditReview
        : isRecord(report?.review)
          ? report.review
          : undefined;
      if (!review) {
        throw new Error('Invalid face-audit review sheet import payload');
      }
      const reviewText = `${JSON.stringify(review, null, 2)}\n`;
      setReviewArtifactText(reviewText);
      downloadTextArtifact(faceAuditReviewFromSheetFileName(), reviewText, 'application/json');
      const appliedItemCount = typeof report?.appliedItemCount === 'number'
        ? report.appliedItemCount
        : undefined;
      const reviewFingerprint = typeof report?.reviewFingerprint === 'string'
        ? report.reviewFingerprint
        : undefined;
      setReviewArtifactMessage(faceAuditReviewSheetImportDownloadLabel(appliedItemCount, reviewFingerprint));
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function downloadFaceAuditReviewerInstructionsArtifacts() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const response = await fetch(`${serverUrl}${faceAuditReviewerInstructionsPath()}`, {
        ...faceAuditReviewArtifactRequestOptions(mergeArtifactText, 'Reviewer instructions'),
      });
      if (!response.ok) {
        throw new Error(`Reviewer instructions request failed with HTTP ${response.status}`);
      }
      const text = await response.text();
      downloadTextArtifact(
        faceAuditReviewerInstructionsFileName(),
        text,
        response.headers.get('content-type') ?? 'text/markdown',
      );
      setReviewArtifactMessage(faceAuditReviewerInstructionsDownloadLabel(
        response.headers.get('x-face-audit-review-fingerprint'),
      ));
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function downloadFaceAuditAreaReviewerInstructionsArtifact() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const area = faceAuditReviewAreaName(selectedReviewArea);
      if (!area) {
        throw new Error('Select a valid face-audit area');
      }
      const response = await fetch(`${serverUrl}${faceAuditAreaReviewerInstructionsPath(area)}`, {
        ...faceAuditReviewArtifactRequestOptions(mergeArtifactText, 'Area reviewer instructions'),
      });
      if (!response.ok) {
        throw new Error(`Area reviewer instructions request failed with HTTP ${response.status}`);
      }
      const text = await response.text();
      downloadTextArtifact(
        faceAuditAreaReviewerInstructionsFileName(area),
        text,
        response.headers.get('content-type') ?? 'text/markdown',
      );
      setReviewArtifactMessage(faceAuditAreaReviewerInstructionsDownloadLabel(
        area,
        response.headers.get('x-face-audit-review-fingerprint'),
      ));
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function buildFaceAuditReviewerHandoffArtifacts() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const response = await fetch(`${serverUrl}${faceAuditReviewerHandoffPath()}`, {
        ...faceAuditReviewArtifactRequestOptions(mergeArtifactText, 'Reviewer handoff'),
      });
      const payload = await response.json() as unknown;
      const handoff = faceAuditReviewerHandoffFromPayload(payload);
      setReviewHandoffReport(handoff);
      if (response.ok) {
        const handoffArtifact = isRecord(payload) && isRecord(payload.faceAuditReviewerHandoff)
          ? payload.faceAuditReviewerHandoff
          : undefined;
        if (!handoffArtifact) {
          throw new Error('Invalid face-audit reviewer handoff payload');
        }
        downloadTextArtifact(
          faceAuditReviewerHandoffFileName(),
          `${JSON.stringify(handoffArtifact, null, 2)}\n`,
          'application/json',
        );
        setReviewArtifactMessage(
          `${faceAuditReviewerHandoffDownloadLabel(handoff)}. ${faceAuditReviewerHandoffLabel(handoff)}`,
        );
        return;
      }
      setReviewArtifactMessage(faceAuditReviewerHandoffLabel(handoff));
      if (!response.ok && handoff.issueCount === 0) {
        setReviewArtifactMessage(`Reviewer handoff request failed with HTTP ${response.status}`);
      }
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function verifyFaceAuditReviewerHandoffArtifact() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      let artifactPayload: unknown;
      try {
        artifactPayload = JSON.parse(mergeArtifactText) as unknown;
      } catch {
        throw new Error('Reviewer handoff artifact input must be valid JSON');
      }
      const response = await fetch(`${serverUrl}${faceAuditReviewerHandoffVerifyPath()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(artifactPayload),
      });
      const validation = faceAuditReviewerHandoffValidationFromPayload(await response.json());
      setReviewHandoffValidation(validation);
      if (validation.handoff) {
        setReviewHandoffReport(validation.handoff);
      }
      setReviewArtifactMessage(faceAuditReviewerHandoffValidationLabel(validation));
      if (!response.ok && validation.issueCount === 0) {
        setReviewArtifactMessage(`Reviewer handoff verification failed with HTTP ${response.status}`);
      }
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function summarizeFaceAuditReviewerHandoffResponseArtifacts() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      let handoffPayload: unknown;
      let returnedPayload: unknown;
      try {
        handoffPayload = JSON.parse(reviewArtifactText) as unknown;
      } catch {
        throw new Error('Reviewer handoff JSON must be valid');
      }
      try {
        returnedPayload = JSON.parse(mergeArtifactText) as unknown;
      } catch {
        throw new Error('Returned area artifact input must be valid JSON');
      }
      const returnedArtifacts = reviewArtifactsFromPayload(returnedPayload);
      if (!returnedArtifacts) {
        throw new Error('Returned area artifact input must be a JSON array or an object with an artifacts array');
      }
      const response = await fetch(`${serverUrl}${faceAuditReviewerHandoffResponsePath()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          handoff: handoffPayload,
          artifacts: returnedArtifacts,
        }),
      });
      const handoffResponse = faceAuditReviewerHandoffResponseFromPayload(await response.json());
      setReviewHandoffResponse(handoffResponse);
      setReviewArtifactMessage(faceAuditReviewerHandoffResponseLabel(handoffResponse));
      if (!response.ok && handoffResponse.issueCount === 0) {
        setReviewArtifactMessage(`Reviewer handoff response request failed with HTTP ${response.status}`);
      }
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  function loadFaceAuditHandoffAreaArtifact(area: FaceAuditReviewerHandoffView['areas'][number]) {
    setSelectedReviewArea(area.area);
    setReviewArtifactText(JSON.stringify(area.reviewArtifactPayload, null, 2));
    setReviewValidation(undefined);
    setReviewHandoffResponse(undefined);
    setReviewArtifactMessage(`Loaded ${area.area} reviewer handoff area artifact.`);
  }

  function downloadFaceAuditHandoffAreaArtifact(area: FaceAuditReviewerHandoffView['areas'][number]) {
    downloadTextArtifact(
      faceAuditReviewerHandoffAreaFileName(area.area),
      `${JSON.stringify(area.reviewArtifactPayload, null, 2)}\n`,
      'application/json',
    );
    setReviewArtifactMessage(faceAuditReviewerHandoffAreaDownloadLabel(area));
  }

  function fillLoadedFaceAuditAreaReviewArtifact() {
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    let artifact: unknown;
    try {
      artifact = JSON.parse(reviewArtifactText) as unknown;
    } catch {
      setReviewArtifactMessage('Area review artifact must be valid JSON');
      return;
    }
    const fillResult = fillFaceAuditAreaReviewArtifact(artifact, {
      reviewer: reviewFillReviewer,
      reviewedAt: reviewFillReviewedAt,
      evidenceSourceId: reviewFillEvidenceSourceId,
      evidenceSourceLabel: reviewFillEvidenceSourceLabel,
      evidenceSourceType: reviewFillEvidenceSourceType,
      evidenceSourceCitation: reviewFillEvidenceSourceCitation,
      evidenceSourceLocator: reviewFillEvidenceSourceLocator,
      evidenceSourceContentHash: reviewFillEvidenceSourceContentHash,
      evidenceSourceNotes: '',
      evidenceRefScope: reviewFillEvidenceRefScope,
      reviewStatus: reviewFillStatus,
      itemNotes: reviewFillItemNotes,
    });
    if (!fillResult.ok) {
      setReviewArtifactMessage(fillResult.error);
      return;
    }
    setReviewArtifactText(JSON.stringify(fillResult.artifact, null, 2));
    setReviewArtifactMessage(`Filled ${fillResult.area} area review artifact with ${fillResult.itemCount} reviewed item(s).`);
  }

  function faceAuditSourceIdFromInputs(): string {
    if (evidenceSourceArtifactText.trim().length > 0) {
      let artifact: unknown;
      try {
        artifact = JSON.parse(evidenceSourceArtifactText) as unknown;
      } catch {
        return reviewFillEvidenceSourceId;
      }
      return faceAuditEvidenceSourceFromPayload(artifact, selectedEvidenceSourceArtifactId)?.id ??
        reviewFillEvidenceSourceId;
    }
    return reviewFillEvidenceSourceId;
  }

  function faceAuditMatchSourceArtifactFromInputs() {
    if (evidenceSourceArtifactText.trim().length > 0) {
      let artifact: unknown;
      try {
        artifact = JSON.parse(evidenceSourceArtifactText) as unknown;
      } catch {
        throw new Error('Evidence source artifact JSON must be valid');
      }
      const evidenceSources = faceAuditEvidenceSourcesFromPayload(artifact);
      if (evidenceSources === undefined || evidenceSources.length === 0) {
        throw new Error('Evidence source artifact must include at least one valid evidence source');
      }
      return { evidenceSources };
    }
    const evidenceSource: Record<string, unknown> = {
      id: reviewFillEvidenceSourceId,
      label: reviewFillEvidenceSourceLabel,
      sourceType: reviewFillEvidenceSourceType,
      citation: reviewFillEvidenceSourceCitation,
      notes: '',
    };
    if (reviewFillEvidenceSourceLocator.trim().length > 0) {
      evidenceSource.locator = reviewFillEvidenceSourceLocator;
    }
    if (reviewFillEvidenceSourceContentHash.trim().length > 0) {
      evidenceSource.contentHash = reviewFillEvidenceSourceContentHash;
    }
    return { evidenceSources: [evidenceSource] };
  }

  function reviewFillEvidenceRefMode() {
    return reviewFillEvidenceRefScope === 'item' ? 'items' : 'area';
  }

  function setFaceAuditMatchSourceIdForArea(area: FaceAuditArea, sourceId: string) {
    setReviewMatchSourceIdsByArea((previous) => ({
      ...previous,
      [area]: sourceId,
    }));
  }

  function useFaceAuditMatchSourceIdForEveryArea() {
    const sourceIdsByArea = {} as Record<FaceAuditArea, string>;
    for (const area of FACE_AUDIT_AREAS) {
      sourceIdsByArea[area] = reviewMatchFallbackSourceId;
    }
    setReviewMatchSourceIdsByArea(sourceIdsByArea);
  }

  async function requestFaceAuditSourceIdsByAreaTemplate() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const sourceArtifact = faceAuditMatchSourceArtifactFromInputs();
      const defaultSourceId = faceAuditSourceIdFromInputs();
      const sourceIdsByArea = faceAuditSourceIdsByAreaPayload(reviewMatchSourceIdsByArea, defaultSourceId);
      if (sourceIdsByArea === undefined) {
        throw new Error('Select a default evidence source id before generating source ids by area');
      }
      const response = await fetch(`${serverUrl}${faceAuditSourceIdsByAreaTemplatePath()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceArtifact,
          defaultSourceId,
          sourceIdsByArea,
        }),
      });
      const payload = await response.json();
      const generated = faceAuditSourceIdsByAreaFromPayload(payload);
      if (!response.ok || generated === undefined) {
        const validation = isRecord(payload) && isRecord(payload.faceAuditSourceIdsByAreaTemplateValidation)
          ? payload.faceAuditSourceIdsByAreaTemplateValidation
          : undefined;
        const issues = isRecord(validation) && Array.isArray(validation.issues)
          ? validation.issues
            .filter(isRecord)
            .map((issue) => `${String(issue.field)}: ${String(issue.message)}`)
          : [`HTTP ${response.status}`];
        throw new Error(issues.join('; '));
      }
      setReviewMatchSourceIdsByArea(generated);
      setReviewArtifactText(JSON.stringify(generated, null, 2));
      setReviewArtifactMessage('Generated source ids by area template.');
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function downloadFaceAuditSourceIdsByAreaTemplate() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const sourceArtifact = faceAuditMatchSourceArtifactFromInputs();
      const defaultSourceId = faceAuditSourceIdFromInputs();
      const sourceIdsByArea = faceAuditSourceIdsByAreaPayload(reviewMatchSourceIdsByArea, defaultSourceId);
      if (sourceIdsByArea === undefined) {
        throw new Error('Select a default evidence source id before generating source ids by area');
      }
      const response = await fetch(`${serverUrl}${faceAuditSourceIdsByAreaTemplatePath()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceArtifact,
          defaultSourceId,
          sourceIdsByArea,
        }),
      });
      const payload = await response.json() as unknown;
      const generated = faceAuditSourceIdsByAreaFromPayload(payload);
      if (!response.ok || generated === undefined) {
        const validation = isRecord(payload) && isRecord(payload.faceAuditSourceIdsByAreaTemplateValidation)
          ? payload.faceAuditSourceIdsByAreaTemplateValidation
          : undefined;
        const issues = isRecord(validation) && Array.isArray(validation.issues)
          ? validation.issues
            .filter(isRecord)
            .map((issue) => `${String(issue.field)}: ${String(issue.message)}`)
          : [`HTTP ${response.status}`];
        throw new Error(issues.join('; '));
      }
      const artifactText = `${JSON.stringify(generated, null, 2)}\n`;
      setReviewMatchSourceIdsByArea(generated);
      setReviewArtifactText(artifactText.trimEnd());
      downloadTextArtifact(
        faceAuditSourceIdsByAreaFileName(),
        artifactText,
        'application/json',
      );
      setReviewArtifactMessage(faceAuditSourceIdsByAreaDownloadLabel(generated));
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  function useFaceAuditSourceIdsByAreaFromReviewArtifactText() {
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const payload = JSON.parse(reviewArtifactText) as unknown;
      const sourceIdsByArea = faceAuditSourceIdsByAreaFromPayload(payload);
      if (sourceIdsByArea === undefined) {
        throw new Error('Review artifact JSON must be a full source ids by area map');
      }
      setReviewMatchSourceIdsByArea(sourceIdsByArea);
      setReviewArtifactMessage('Loaded source ids by area template.');
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function generateFaceAuditEvidenceSourceArtifact(files: FileList | null) {
    setEvidenceSourceArtifactLoading(true);
    setEvidenceSourceArtifactMessage(undefined);
    try {
      const selectedFiles = files ? [...files] : [];
      if (selectedFiles.length === 0) {
        throw new Error('Select at least one official component evidence file');
      }
      const sourceFiles: FaceAuditEvidenceSourceTemplateFileView[] = await Promise.all(
        selectedFiles.map(async (file) => ({
          locator: file.webkitRelativePath || file.name,
          label: file.name,
          contentHash: `sha256:${hexFromArrayBuffer(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))}`,
        })),
      );
      const result = buildFaceAuditEvidenceSourceTemplateArtifact(reviewFillEvidenceSourceType, sourceFiles);
      if (!result.ok) {
        throw new Error(result.error);
      }
      setEvidenceSourceArtifactText(JSON.stringify(result.artifact, null, 2));
      const firstSource = result.artifact.evidenceSources[0];
      if (firstSource) {
        setSelectedEvidenceSourceArtifactId(firstSource.id);
        setReviewFillEvidenceSourceId(firstSource.id);
        setReviewFillEvidenceSourceLabel(firstSource.label);
        setReviewFillEvidenceSourceCitation(firstSource.citation);
        setReviewFillEvidenceSourceLocator(firstSource.locator);
        setReviewFillEvidenceSourceContentHash(firstSource.contentHash);
      }
      setEvidenceSourceArtifactMessage(`Generated ${faceAuditEvidenceSourceTemplateLabel(result.artifact)}.`);
    } catch (caught) {
      setEvidenceSourceArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setEvidenceSourceArtifactLoading(false);
    }
  }

  function downloadFaceAuditEvidenceSourceArtifact() {
    setEvidenceSourceArtifactMessage(undefined);
    try {
      const payload = JSON.parse(evidenceSourceArtifactText) as unknown;
      const template = faceAuditEvidenceSourceTemplateFromPayload(payload);
      if (template === undefined) {
        throw new Error('Evidence source artifact must be valid source-template JSON');
      }
      downloadTextArtifact(
        faceAuditEvidenceSourceTemplateFileName(),
        `${JSON.stringify(template, null, 2)}\n`,
        'application/json',
      );
      setEvidenceSourceArtifactMessage(faceAuditEvidenceSourceTemplateDownloadLabel(template));
    } catch (caught) {
      setEvidenceSourceArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function useFirstFaceAuditEvidenceSourceFromArtifact() {
    setEvidenceSourceArtifactMessage(undefined);
    try {
      const artifact = JSON.parse(evidenceSourceArtifactText) as unknown;
      const selectedSource = faceAuditEvidenceSourceFromPayload(artifact, selectedEvidenceSourceArtifactId);
      if (!selectedSource) {
        throw new Error('Evidence source artifact must include at least one valid evidence source');
      }
      setSelectedEvidenceSourceArtifactId(selectedSource.id);
      setReviewFillEvidenceSourceId(selectedSource.id);
      setReviewFillEvidenceSourceLabel(selectedSource.label);
      setReviewFillEvidenceSourceType(selectedSource.sourceType);
      setReviewFillEvidenceSourceCitation(selectedSource.citation);
      setReviewFillEvidenceSourceLocator(selectedSource.locator ?? '');
      setReviewFillEvidenceSourceContentHash(selectedSource.contentHash ?? '');
      setEvidenceSourceArtifactMessage(`Loaded evidence source ${selectedSource.id} from artifact.`);
    } catch (caught) {
      setEvidenceSourceArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function requestFaceAuditEvidenceRefTemplate() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setEvidenceRefTemplate(undefined);
    try {
      const area = faceAuditReviewAreaName(selectedReviewArea);
      if (!area) {
        throw new Error('Select a known face-audit area');
      }
      const response = await fetch(`${serverUrl}${faceAuditEvidenceRefTemplatePath()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: faceAuditSourceIdFromInputs(),
          area,
          mode: reviewFillEvidenceRefMode(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        const validation = isRecord(payload) && isRecord(payload.faceAuditEvidenceRefTemplateValidation)
          ? payload.faceAuditEvidenceRefTemplateValidation
          : undefined;
        const issues = isRecord(validation) && Array.isArray(validation.issues)
          ? validation.issues
            .filter(isRecord)
            .map((issue) => `${String(issue.field)}: ${String(issue.message)}`)
          : [`HTTP ${response.status}`];
        throw new Error(issues.join('; '));
      }
      const template = faceAuditEvidenceRefTemplateFromPayload(payload);
      setEvidenceRefTemplate(template);
      setReviewArtifactMessage(faceAuditEvidenceRefTemplateLabel(template));
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function downloadFaceAuditEvidenceRefTemplate() {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setEvidenceRefTemplate(undefined);
    try {
      const area = faceAuditReviewAreaName(selectedReviewArea);
      if (!area) {
        throw new Error('Select a known face-audit area');
      }
      const response = await fetch(`${serverUrl}${faceAuditEvidenceRefTemplatePath()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: faceAuditSourceIdFromInputs(),
          area,
          mode: reviewFillEvidenceRefMode(),
        }),
      });
      const payload = await response.json() as unknown;
      if (!response.ok) {
        const validation = isRecord(payload) && isRecord(payload.faceAuditEvidenceRefTemplateValidation)
          ? payload.faceAuditEvidenceRefTemplateValidation
          : undefined;
        const issues = isRecord(validation) && Array.isArray(validation.issues)
          ? validation.issues
            .filter(isRecord)
            .map((issue) => `${String(issue.field)}: ${String(issue.message)}`)
          : [`HTTP ${response.status}`];
        throw new Error(issues.join('; '));
      }
      const template = faceAuditEvidenceRefTemplateFromPayload(payload);
      const templateArtifact = isRecord(payload) && isRecord(payload.faceAuditEvidenceRefTemplate)
        ? payload.faceAuditEvidenceRefTemplate
        : undefined;
      if (templateArtifact === undefined) {
        throw new Error('Invalid face-audit evidence ref template payload');
      }
      setEvidenceRefTemplate(template);
      downloadTextArtifact(
        faceAuditEvidenceRefTemplateFileName(template),
        `${JSON.stringify(templateArtifact, null, 2)}\n`,
        'application/json',
      );
      setReviewArtifactMessage(
        `${faceAuditEvidenceRefTemplateDownloadLabel(template)}. ${faceAuditEvidenceRefTemplateLabel(template)}`,
      );
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function buildFaceAuditMatchReviewArtifact(scope: 'area' | 'full') {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      const area = scope === 'area' ? faceAuditReviewAreaName(selectedReviewArea) : undefined;
      if (scope === 'area' && !area) {
        throw new Error('Select a known face-audit area');
      }
      const sourceArtifact = faceAuditMatchSourceArtifactFromInputs();
      const sourceId = faceAuditSourceIdFromInputs();
      const sourceIdsByArea = scope === 'full'
        ? faceAuditSourceIdsByAreaPayload(reviewMatchSourceIdsByArea, sourceId)
        : undefined;
      const response = await fetch(`${serverUrl}${faceAuditReviewMatchPath(area)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceArtifact,
          sourceId,
          ...(sourceIdsByArea === undefined ? {} : { sourceIdsByArea }),
          reviewer: reviewFillReviewer,
          reviewedAt: reviewFillReviewedAt,
          mode: reviewFillEvidenceRefMode(),
        }),
      });
      const payload = await response.json();
      const validationPayload = isRecord(payload) && isRecord(payload.faceAuditAreaReviewValidation)
        ? { faceAuditReviewValidation: payload.faceAuditAreaReviewValidation }
        : payload;
      const validation = faceAuditReviewValidationFromPayload(validationPayload);
      setReviewValidation(validation);
      if (!response.ok) {
        setReviewArtifactMessage(faceAuditReviewValidationLabel(validation));
        return;
      }
      if (scope === 'area') {
        const areaReview = faceAuditAreaReviewTemplateFromPayload(payload);
        if (!areaReview || !isRecord(payload) || !isRecord(payload.faceAuditAreaReview)) {
          throw new Error('Invalid face-audit area match artifact payload');
        }
        setReviewArtifactText(JSON.stringify(payload.faceAuditAreaReview, null, 2));
        setReviewArtifactMessage(`Generated ${areaReview.area} match artifact. ${faceAuditReviewValidationLabel(validation)}`);
        return;
      }
      const fullReview = faceAuditReviewTemplateFromPayload(payload);
      if (!fullReview || !isRecord(payload) || !isRecord(payload.faceAuditReview)) {
        throw new Error('Invalid face-audit full match artifact payload');
      }
      setReviewArtifactText(JSON.stringify(payload.faceAuditReview, null, 2));
      setReviewArtifactMessage(`Generated full match artifact. ${faceAuditReviewValidationLabel(validation)}`);
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function submitFaceAuditReviewArtifact(type: FaceAuditReviewSubmissionType) {
    setReviewArtifactLoading(true);
    setReviewArtifactMessage(undefined);
    setReviewValidation(undefined);
    setReviewStatusReport(undefined);
    setReviewTodoReport(undefined);
    setReviewPlanReport(undefined);
    setReviewHandoffReport(undefined);
    setEvidenceRefTemplate(undefined);
    setReviewHandoffValidation(undefined);
    setReviewHandoffResponse(undefined);
    try {
      let artifact: unknown;
      try {
        artifact = JSON.parse(reviewArtifactText) as unknown;
      } catch {
        throw new Error('Review artifact must be valid JSON');
      }
      const response = await fetch(`${serverUrl}${faceAuditReviewSubmissionPath(type)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(artifact),
      });
      const payload = await response.json();
      if (type === 'lock-artifact' && response.ok) {
        const lockArtifact = faceAuditLockArtifactFromPayload(payload);
        if (!lockArtifact) {
          throw new Error('Invalid face-audit lock artifact payload');
        }
        setLockArtifactText(JSON.stringify(payload.faceAuditLockArtifact, null, 2));
        setLockArtifactValidation(undefined);
        setReleaseGate(undefined);
        setLockArtifactMessage(`Generated ${faceAuditLockArtifactLabel(lockArtifact)}`);
        setReviewArtifactMessage(`Lock artifact generated. ${faceAuditLockArtifactLabel(lockArtifact)}`);
        return;
      }
      const validation = faceAuditReviewValidationFromPayload(payload);
      setReviewValidation(validation);
      setReviewArtifactMessage(faceAuditReviewSubmissionLabel(type, validation));
    } catch (caught) {
      setReviewArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReviewArtifactLoading(false);
    }
  }

  async function verifyFaceAuditLockArtifact() {
    setLockArtifactLoading(true);
    setLockArtifactMessage(undefined);
    setLockArtifactValidation(undefined);
    setReleaseGate(undefined);
    try {
      let artifact: unknown;
      try {
        artifact = JSON.parse(lockArtifactText) as unknown;
      } catch {
        throw new Error('Lock artifact must be valid JSON');
      }
      const response = await fetch(`${serverUrl}${faceAuditLockArtifactVerifyPath()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(artifact),
      });
      const validation = faceAuditLockArtifactValidationFromPayload(await response.json());
      setLockArtifactValidation(validation);
      setLockArtifactMessage(faceAuditLockArtifactValidationLabel(validation));
    } catch (caught) {
      setLockArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLockArtifactLoading(false);
    }
  }

  async function checkFaceAuditReleaseGate() {
    setLockArtifactLoading(true);
    setLockArtifactMessage(undefined);
    setLockArtifactValidation(undefined);
    setReleaseGate(undefined);
    try {
      let requestBody: Record<string, unknown> = {};
      if (lockArtifactText.trim().length > 0) {
        let artifact: unknown;
        try {
          artifact = JSON.parse(lockArtifactText) as unknown;
        } catch {
          throw new Error('Lock artifact must be valid JSON');
        }
        requestBody = { lockArtifact: artifact };
      }
      const response = await fetch(`${serverUrl}${faceAuditReleaseGatePath()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const gate = faceAuditStaticLockGateFromPayload(await response.json());
      setReleaseGate(gate);
      setLockArtifactValidation(gate.lockArtifactValidation);
      setLockArtifactMessage(faceAuditStaticLockGateLabel(gate));
      if (!response.ok && gate.issueCount === 0) {
        setLockArtifactMessage(`Release gate request failed with HTTP ${response.status}`);
      }
    } catch (caught) {
      setLockArtifactMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLockArtifactLoading(false);
    }
  }

  return (
    <section>
      <h2>Rules Data Face Audit</h2>
      <button type="button" onClick={() => void loadFaceAuditChecklist()} disabled={loading}>
        {loading ? 'Loading checklist' : 'Refresh checklist'}
      </button>
      <button type="button" onClick={clearReviewedItems} disabled={reviewedItemKeys.length === 0}>
        Clear reviewed
      </button>
      {error && <div>{error}</div>}
      {checklist.areas.length === 0 ? (
        <div>No checklist loaded.</div>
      ) : (
        <>
          <div>Total checklist items: {totalItems}</div>
          <div>{faceAuditChecklistIdentityLabel(checklist)}</div>
          {checklist.checklistItemCount !== undefined && (
            <div>Checklist export item count: {checklist.checklistItemCount}</div>
          )}
          <div>Reviewed checklist items: {faceAuditProgressLabel(progress)}</div>
          <div>
            <button type="button" onClick={exportReviewedItems}>Export progress</button>
            <button type="button" onClick={importReviewedItems}>Import progress</button>
          </div>
          <label>
            Progress artifact JSON
            <textarea
              rows={8}
              value={progressArtifactText}
              onChange={(event) => setProgressArtifactText(event.target.value)}
            />
          </label>
          {progressArtifactMessage && <div>{progressArtifactMessage}</div>}
          <div>
            <label>
              Area review template
              <select
                value={selectedReviewArea}
                onChange={(event) => {
                  setSelectedReviewArea(event.target.value);
                  setReviewAreaTodoSummaryReport(undefined);
                }}
              >
                {checklist.areas.map((summary) => (
                  <option key={summary.area} value={summary.area}>
                    {summary.area}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void loadFaceAuditReviewTemplate()}
              disabled={reviewArtifactLoading}
            >
              {reviewArtifactLoading ? 'Working with review artifact' : 'Load review template'}
            </button>
            <button
              type="button"
              onClick={() => void downloadFaceAuditReviewTemplate()}
              disabled={reviewArtifactLoading}
            >
              Download review template
            </button>
            <button
              type="button"
              onClick={() => void loadFaceAuditAreaReviewTemplate()}
              disabled={reviewArtifactLoading || checklist.areas.length === 0}
            >
              Load area template
            </button>
            <button
              type="button"
              onClick={() => void downloadFaceAuditAreaReviewTemplate()}
              disabled={reviewArtifactLoading || checklist.areas.length === 0}
            >
              Download area template
            </button>
            <button
              type="button"
              onClick={() => void submitFaceAuditReviewArtifact('validate')}
              disabled={reviewArtifactLoading || reviewArtifactText.trim().length === 0}
            >
              Validate review artifact
            </button>
            <button
              type="button"
              onClick={importReviewArtifactProgress}
              disabled={reviewArtifactLoading || reviewArtifactText.trim().length === 0}
            >
              Import review progress
            </button>
            <button
              type="button"
              onClick={() => void submitFaceAuditReviewArtifact('ready')}
              disabled={reviewArtifactLoading || reviewArtifactText.trim().length === 0}
            >
              Ready check
            </button>
            <button
              type="button"
              onClick={() => void submitFaceAuditReviewArtifact('lock-preview')}
              disabled={reviewArtifactLoading || reviewArtifactText.trim().length === 0}
            >
              Lock preview
            </button>
            <button
              type="button"
              onClick={() => void submitFaceAuditReviewArtifact('lock-artifact')}
              disabled={reviewArtifactLoading || reviewArtifactText.trim().length === 0}
            >
              Generate lock artifact
            </button>
          </div>
          <label>
            Review artifacts to merge JSON
            <textarea
              rows={8}
              value={mergeArtifactText}
              onChange={(event) => {
                setMergeArtifactText(event.target.value);
                setReviewStatusReport(undefined);
                setReviewTodoReport(undefined);
                setReviewAreaTodoSummaryReport(undefined);
                setReviewPlanReport(undefined);
                setReviewHandoffReport(undefined);
                setEvidenceRefTemplate(undefined);
                setReviewHandoffValidation(undefined);
                setReviewHandoffResponse(undefined);
              }}
            />
          </label>
          <label>
            Review sheet TSV to apply
            <textarea
              rows={8}
              value={reviewSheetImportText}
              onChange={(event) => {
                setReviewSheetImportText(event.target.value);
                setReviewStatusReport(undefined);
                setReviewTodoReport(undefined);
                setReviewAreaTodoSummaryReport(undefined);
                setReviewPlanReport(undefined);
                setReviewHandoffReport(undefined);
                setReviewHandoffValidation(undefined);
                setReviewHandoffResponse(undefined);
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => void mergeFaceAuditReviewArtifacts()}
            disabled={reviewArtifactLoading || mergeArtifactText.trim().length === 0}
          >
            Merge review artifacts
          </button>
          <button
            type="button"
            onClick={() => void summarizeFaceAuditReviewArtifacts()}
            disabled={reviewArtifactLoading}
          >
            Summarize review status
          </button>
          <button
            type="button"
            onClick={() => void summarizeFaceAuditReviewTodoArtifacts()}
            disabled={reviewArtifactLoading}
          >
            Summarize review todo
          </button>
          <button
            type="button"
            onClick={() => void downloadFaceAuditReviewTodoArtifact()}
            disabled={reviewArtifactLoading}
          >
            Download review todo
          </button>
          <button
            type="button"
            onClick={() => void downloadFaceAuditReviewTodoSummaryArtifact()}
            disabled={reviewArtifactLoading}
          >
            Download review todo summary
          </button>
          <button
            type="button"
            onClick={() => void summarizeFaceAuditAreaReviewTodoArtifacts()}
            disabled={reviewArtifactLoading}
          >
            Summarize area todo
          </button>
          <button
            type="button"
            onClick={() => void downloadFaceAuditAreaReviewTodoSummaryArtifact()}
            disabled={reviewArtifactLoading}
          >
            Download area todo summary
          </button>
          <button
            type="button"
            onClick={() => void buildFaceAuditReviewPlanArtifacts()}
            disabled={reviewArtifactLoading}
          >
            Build review plan
          </button>
          <button
            type="button"
            onClick={() => void downloadFaceAuditReviewPlanArtifact()}
            disabled={reviewArtifactLoading}
          >
            Download review plan
          </button>
          <button
            type="button"
            onClick={() => void downloadFaceAuditReviewSheetArtifacts()}
            disabled={reviewArtifactLoading}
          >
            Download review sheet
          </button>
          <button
            type="button"
            onClick={() => void downloadFaceAuditAreaReviewSheetArtifact()}
            disabled={reviewArtifactLoading}
          >
            Download area review sheet
          </button>
          <button
            type="button"
            onClick={() => void applyFaceAuditReviewSheetArtifacts()}
            disabled={
              reviewArtifactLoading ||
              mergeArtifactText.trim().length === 0 ||
              reviewSheetImportText.trim().length === 0
            }
          >
            Apply review sheet
          </button>
          <button
            type="button"
            onClick={() => void downloadFaceAuditReviewerInstructionsArtifacts()}
            disabled={reviewArtifactLoading}
          >
            Download reviewer instructions
          </button>
          <button
            type="button"
            onClick={() => void downloadFaceAuditAreaReviewerInstructionsArtifact()}
            disabled={reviewArtifactLoading}
          >
            Download area reviewer instructions
          </button>
          <button
            type="button"
            onClick={() => void buildFaceAuditReviewerHandoffArtifacts()}
            disabled={reviewArtifactLoading}
          >
            Build reviewer handoff
          </button>
          <button
            type="button"
            onClick={() => void verifyFaceAuditReviewerHandoffArtifact()}
            disabled={reviewArtifactLoading || mergeArtifactText.trim().length === 0}
          >
            Verify reviewer handoff
          </button>
          <button
            type="button"
            onClick={() => void summarizeFaceAuditReviewerHandoffResponseArtifacts()}
            disabled={
              reviewArtifactLoading ||
              reviewArtifactText.trim().length === 0 ||
              mergeArtifactText.trim().length === 0
            }
          >
            Summarize handoff response
          </button>
          <div>
            <label>
              Reviewer
              <input
                value={reviewFillReviewer}
                onChange={(event) => setReviewFillReviewer(event.target.value)}
              />
            </label>
            <label>
              Reviewed at
              <input
                value={reviewFillReviewedAt}
                onChange={(event) => setReviewFillReviewedAt(event.target.value)}
              />
            </label>
            <label>
              Review status
              <select
                value={reviewFillStatus}
                onChange={(event) => setReviewFillStatus(event.target.value as FaceAuditAreaReviewFillOptions['reviewStatus'])}
              >
                <option value="matches_official_face">matches_official_face</option>
                <option value="differs_from_official_face">differs_from_official_face</option>
                <option value="needs_better_reference">needs_better_reference</option>
              </select>
            </label>
            <label>
              Evidence ref scope
              <select
                value={reviewFillEvidenceRefScope}
                onChange={(event) =>
                  setReviewFillEvidenceRefScope(event.target.value as NonNullable<FaceAuditAreaReviewFillOptions['evidenceRefScope']>)}
              >
                <option value="area">area</option>
                <option value="item">item-specific</option>
              </select>
            </label>
            <label>
              Evidence source id
              <input
                value={reviewFillEvidenceSourceId}
                onChange={(event) => setReviewFillEvidenceSourceId(event.target.value)}
              />
            </label>
            <label>
              Evidence source label
              <input
                value={reviewFillEvidenceSourceLabel}
                onChange={(event) => setReviewFillEvidenceSourceLabel(event.target.value)}
              />
            </label>
            <label>
              Evidence source type
              <select
                value={reviewFillEvidenceSourceType}
                onChange={(event) => setReviewFillEvidenceSourceType(event.target.value as FaceAuditAreaReviewFillOptions['evidenceSourceType'])}
              >
                <option value="official_physical_component">official_physical_component</option>
                <option value="official_high_res_component_image">official_high_res_component_image</option>
              </select>
            </label>
            <label>
              Evidence source files
              <input
                type="file"
                multiple
                onChange={(event) => void generateFaceAuditEvidenceSourceArtifact(event.target.files)}
                disabled={evidenceSourceArtifactLoading}
              />
            </label>
            <label>
              Evidence source citation
              <input
                value={reviewFillEvidenceSourceCitation}
                onChange={(event) => setReviewFillEvidenceSourceCitation(event.target.value)}
              />
            </label>
            <label>
              Evidence source locator
              <input
                value={reviewFillEvidenceSourceLocator}
                onChange={(event) => setReviewFillEvidenceSourceLocator(event.target.value)}
              />
            </label>
            <label>
              Evidence source content hash
              <input
                value={reviewFillEvidenceSourceContentHash}
                onChange={(event) => setReviewFillEvidenceSourceContentHash(event.target.value)}
              />
            </label>
            <label>
              Evidence source artifact JSON
              <textarea
                rows={5}
                value={evidenceSourceArtifactText}
                onChange={(event) => {
                  setEvidenceSourceArtifactText(event.target.value);
                  setEvidenceSourceArtifactMessage(undefined);
                }}
              />
            </label>
            <label>
              Evidence source from artifact
              <select
                value={selectedEvidenceSourceArtifactId}
                onChange={(event) => setSelectedEvidenceSourceArtifactId(event.target.value)}
                disabled={evidenceSourceArtifactSources.length === 0}
              >
                {evidenceSourceArtifactSources.length === 0 && <option value="">No valid evidence sources</option>}
                {evidenceSourceArtifactSources.map((source) => (
                  <option key={source.id} value={source.id}>{faceAuditEvidenceSourceLabel(source)}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={useFirstFaceAuditEvidenceSourceFromArtifact}
              disabled={evidenceSourceArtifactText.trim().length === 0}
            >
              Use selected evidence source
            </button>
            <button
              type="button"
              onClick={downloadFaceAuditEvidenceSourceArtifact}
              disabled={evidenceSourceArtifactLoading || evidenceSourceArtifactText.trim().length === 0}
            >
              Download evidence sources
            </button>
            <div>
              <div>Full match area sources</div>
              <button
                type="button"
                onClick={useFaceAuditMatchSourceIdForEveryArea}
                disabled={reviewMatchAreaSourceOptions.length === 0}
              >
                Use selected source for all areas
              </button>
              <button
                type="button"
                onClick={() => void requestFaceAuditSourceIdsByAreaTemplate()}
                disabled={reviewArtifactLoading || reviewMatchAreaSourceOptions.length === 0}
              >
                Generate source ids by area
              </button>
              <button
                type="button"
                onClick={() => void downloadFaceAuditSourceIdsByAreaTemplate()}
                disabled={reviewArtifactLoading || reviewMatchAreaSourceOptions.length === 0}
              >
                Download source ids by area
              </button>
              <button
                type="button"
                onClick={useFaceAuditSourceIdsByAreaFromReviewArtifactText}
                disabled={reviewArtifactText.trim().length === 0}
              >
                Use source ids by area JSON
              </button>
              {FACE_AUDIT_AREAS.map((area) => (
                <label key={area}>
                  {area}
                  <select
                    value={reviewMatchSourceIdsByArea[area] ?? reviewMatchFallbackSourceId}
                    onChange={(event) => setFaceAuditMatchSourceIdForArea(area, event.target.value)}
                    disabled={reviewMatchAreaSourceOptions.length === 0}
                  >
                    {reviewMatchAreaSourceOptions.length === 0 && <option value="">No valid evidence sources</option>}
                    {reviewMatchAreaSourceOptions.map((source) => (
                      <option key={source.id} value={source.id}>{faceAuditEvidenceSourceLabel(source)}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {evidenceSourceArtifactMessage && <div>{evidenceSourceArtifactMessage}</div>}
            <label>
              Item notes
              <textarea
                rows={3}
                value={reviewFillItemNotes}
                onChange={(event) => setReviewFillItemNotes(event.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={fillLoadedFaceAuditAreaReviewArtifact}
              disabled={reviewArtifactText.trim().length === 0}
            >
              Fill loaded area artifact
            </button>
            <button
              type="button"
              onClick={() => void requestFaceAuditEvidenceRefTemplate()}
              disabled={reviewArtifactLoading}
            >
              Generate evidence refs
            </button>
            <button
              type="button"
              onClick={() => void downloadFaceAuditEvidenceRefTemplate()}
              disabled={reviewArtifactLoading}
            >
              Download evidence refs
            </button>
            <button
              type="button"
              onClick={() => void buildFaceAuditMatchReviewArtifact('area')}
              disabled={reviewArtifactLoading}
            >
              Build selected area match artifact
            </button>
            <button
              type="button"
              onClick={() => void buildFaceAuditMatchReviewArtifact('full')}
              disabled={reviewArtifactLoading}
            >
              Build full match artifact
            </button>
          </div>
          <label>
            Review artifact JSON
            <textarea
              rows={8}
              value={reviewArtifactText}
              onChange={(event) => {
                setReviewArtifactText(event.target.value);
                setReviewValidation(undefined);
                setEvidenceRefTemplate(undefined);
                setReviewHandoffResponse(undefined);
                setReviewPlanReport(undefined);
              }}
            />
          </label>
          {reviewArtifactMessage && <div>{reviewArtifactMessage}</div>}
          {evidenceRefTemplate && (
            <div>
              <div>{faceAuditEvidenceRefTemplateLabel(evidenceRefTemplate)}</div>
              {visibleEvidenceRefs.length > 0 && (
                <ul>
                  {visibleEvidenceRefs.map((evidenceRef) => (
                    <li key={evidenceRef}>{evidenceRef}</li>
                  ))}
                </ul>
              )}
              {evidenceRefTemplate.evidenceRefCount > visibleEvidenceRefs.length && (
                <div>{evidenceRefTemplate.evidenceRefCount - visibleEvidenceRefs.length} more evidence ref(s) omitted.</div>
              )}
            </div>
          )}
          {reviewStatusReport && reviewStatusReport.areaProgress.length > 0 && (
            <div>
              <div>Review status areas</div>
              <div>Artifact: {reviewStatusReport.artifactType ?? 'unknown'} v{reviewStatusReport.version ?? '?'}</div>
              {reviewStatusReport.checklistFingerprint && (
                <div>Checklist: {reviewStatusReport.checklistFingerprint}</div>
              )}
              {reviewStatusReport.reviewFingerprint && (
                <div>Review: {reviewStatusReport.reviewFingerprint}</div>
              )}
              {reviewStatusReport.evidenceSourceCount !== undefined && (
                <div>
                  Evidence sources: {reviewStatusReport.usedEvidenceSourceCount} used /{' '}
                  {reviewStatusReport.evidenceSourceCount} declared
                </div>
              )}
              {reviewStatusReport.unusedEvidenceSourceIds.length > 0 && (
                <div>Unused evidence sources: {reviewStatusReport.unusedEvidenceSourceIds.join(', ')}</div>
              )}
              <div>Areas: {faceAuditAreaCompletionCountsLabel(reviewStatusReport.areaCompletionCounts)}</div>
              <ul>
                {reviewStatusReport.areaProgress.map((area) => (
                  <li key={area.area}>
                    <div>
                      {area.area}: {area.completionStatus}; {area.reviewedItemCount} / {area.itemCount} reviewed,
                      {' '}{area.matchingItemCount} matched,
                      {' '}{area.differenceItemCount} differences,
                      {' '}{area.needsReferenceItemCount} need reference,
                      {' '}{area.unreviewedItemCount} unreviewed,
                      {' '}{faceAuditEvidenceCoverageLabel(area)}
                      {area.evidenceSourceIds.length > 0 && ` from ${area.evidenceSourceIds.join(', ')}`}
                      {area.reviewers.length > 0 && ` by ${area.reviewers.join(', ')}`}
                    </div>
                    {(
                      area.differenceItemKeys.length > 0 ||
                      area.needsReferenceItemKeys.length > 0 ||
                      area.unreviewedItemKeys.length > 0 ||
                      area.evidenceRefs.length > 0 ||
                      area.reviewers.length > 0 ||
                      area.firstReviewedAt.length > 0
                    ) && (
                        <details>
                          <summary>Open audit details</summary>
                          {area.reviewers.length > 0 && (
                            <div>Reviewers: {area.reviewers.join(', ')}</div>
                          )}
                          {area.firstReviewedAt.length > 0 && (
                            <div>Reviewed: {area.firstReviewedAt} - {area.lastReviewedAt}</div>
                          )}
                          {area.evidenceRefs.length > 0 && (
                            <div>Evidence refs: {area.evidenceRefs.join(', ')}</div>
                          )}
                          {area.differenceItemKeys.length > 0 && (
                            <div>Differences: {area.differenceItemKeys.join(', ')}</div>
                          )}
                          {area.needsReferenceItemKeys.length > 0 && (
                            <div>Need reference: {area.needsReferenceItemKeys.join(', ')}</div>
                          )}
                          {area.unreviewedItemKeys.length > 0 && (
                            <div>Unreviewed: {area.unreviewedItemKeys.join(', ')}</div>
                          )}
                        </details>
                      )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {reviewTodoReport && (
            <div>
              <div>Review todo handoff</div>
              <div>Artifact: {reviewTodoReport.artifactType ?? 'unknown'} v{reviewTodoReport.version ?? '?'}</div>
              {reviewTodoReport.checklistFingerprint && (
                <div>Checklist: {reviewTodoReport.checklistFingerprint}</div>
              )}
              {reviewTodoReport.reviewFingerprint && (
                <div>Review: {reviewTodoReport.reviewFingerprint}</div>
              )}
              <div>
                Areas: {reviewTodoReport.pendingAreaCount} unfinished, {reviewTodoReport.readyAreaCount} ready
              </div>
              {reviewTodoReport.commands && (
                <details>
                  <summary>Open full review commands</summary>
                  <div>Template: {reviewTodoReport.commands.blankTemplate}</div>
                  <div>Template with sources: {reviewTodoReport.commands.blankTemplateWithSources}</div>
                  <div>Source ids by area: {reviewTodoReport.commands.sourceIdsByAreaTemplate}</div>
                  <div>Full match: {reviewTodoReport.commands.reviewMatchTemplate}</div>
                  <div>Full match with item refs: {reviewTodoReport.commands.reviewMatchTemplateWithItemRefs}</div>
                  <div>Full match by area: {reviewTodoReport.commands.reviewMatchTemplateByArea}</div>
                  <div>
                    Full match by area with item refs:{' '}
                    {reviewTodoReport.commands.reviewMatchTemplateByAreaWithItemRefs}
                  </div>
                </details>
              )}
              {reviewTodoReport.areas.length === 0 ? (
                <div>No unfinished face-audit areas.</div>
              ) : (
                <ul>
                  {reviewTodoReport.areas.map((area) => (
                    <li key={area.area}>
                      <div>{faceAuditReviewTodoAreaLabel(area)}</div>
                      <details>
                        <summary>Open todo details</summary>
                        <div>Status: {area.status}; completion: {area.completionStatus}</div>
                        <div>
                          Counts: {area.matchingItemCount} matched,
                          {' '}{area.differenceItemCount} differences,
                          {' '}{area.needsReferenceItemCount} need reference,
                          {' '}{area.unreviewedItemCount} unreviewed
                        </div>
                        {area.evidenceSourceIds.length > 0 && (
                          <div>Evidence sources: {area.evidenceSourceIds.join(', ')}</div>
                        )}
                        {area.nextItemKeys.length > 0 && (
                          <div>
                            Next item keys: {area.nextItemKeys.join(', ')}
                            {area.remainingItemKeyCount > area.nextItemKeys.length &&
                              `, ${area.remainingItemKeyCount - area.nextItemKeys.length} more`}
                          </div>
                        )}
                        <div>Template: {area.commands.blankTemplate}</div>
                        <div>Template with sources: {area.commands.blankTemplateWithSources}</div>
                        <div>Area match: {area.commands.areaMatchTemplate}</div>
                        <div>Area match with item refs: {area.commands.areaMatchTemplateWithItemRefs}</div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {reviewAreaTodoSummaryReport && (
            <div>
              <div>Area todo summary</div>
              <div>{faceAuditAreaReviewTodoSummaryLabel(reviewAreaTodoSummaryReport)}</div>
              <div>Artifact: {reviewAreaTodoSummaryReport.artifactType ?? 'unknown'} v{reviewAreaTodoSummaryReport.version ?? '?'}</div>
              {reviewAreaTodoSummaryReport.checklistFingerprint && (
                <div>Checklist: {reviewAreaTodoSummaryReport.checklistFingerprint}</div>
              )}
              {reviewAreaTodoSummaryReport.reviewFingerprint && (
                <div>Review: {reviewAreaTodoSummaryReport.reviewFingerprint}</div>
              )}
              <div>
                Area: {reviewAreaTodoSummaryReport.area ?? selectedReviewArea};
                {' '}completion: {reviewAreaTodoSummaryReport.completionStatus ?? 'unknown'};
                {' '}next: {reviewAreaTodoSummaryReport.nextStep ?? 'unknown'}
              </div>
              <div>
                Counts: {reviewAreaTodoSummaryReport.matchingItemCount} matched,
                {' '}{reviewAreaTodoSummaryReport.differenceItemCount} differences,
                {' '}{reviewAreaTodoSummaryReport.needsReferenceItemCount} need reference,
                {' '}{reviewAreaTodoSummaryReport.unreviewedItemCount} unreviewed,
                {' '}{reviewAreaTodoSummaryReport.remainingItemCount} remaining
              </div>
              <div>
                Evidence: {reviewAreaTodoSummaryReport.evidenceRefCount} ref(s),
                {' '}{reviewAreaTodoSummaryReport.areaLevelEvidenceRefCount} area-level,
                {' '}{reviewAreaTodoSummaryReport.itemSpecificEvidenceRefCount} item-specific
              </div>
              {reviewAreaTodoSummaryReport.evidenceSourceIds.length > 0 && (
                <div>Evidence sources: {reviewAreaTodoSummaryReport.evidenceSourceIds.join(', ')}</div>
              )}
            </div>
          )}
          {reviewPlanReport && (
            <div>
              <div>Review assignment plan</div>
              <div>Artifact: {reviewPlanReport.artifactType ?? 'unknown'} v{reviewPlanReport.version ?? '?'}</div>
              {reviewPlanReport.checklistFingerprint && (
                <div>Checklist: {reviewPlanReport.checklistFingerprint}</div>
              )}
              {reviewPlanReport.reviewFingerprint && (
                <div>Review: {reviewPlanReport.reviewFingerprint}</div>
              )}
              <div>
                Areas: {reviewPlanReport.pendingAreaCount} unfinished, {reviewPlanReport.readyAreaCount} ready;
                {' '}{reviewPlanReport.pendingItemCount} item(s) to assign
              </div>
              {reviewPlanReport.commands && (
                <details>
                  <summary>Open full review commands</summary>
                  <div>Template: {reviewPlanReport.commands.blankTemplate}</div>
                  <div>Template with sources: {reviewPlanReport.commands.blankTemplateWithSources}</div>
                  <div>Source ids by area: {reviewPlanReport.commands.sourceIdsByAreaTemplate}</div>
                  <div>Full match: {reviewPlanReport.commands.reviewMatchTemplate}</div>
                  <div>Full match with item refs: {reviewPlanReport.commands.reviewMatchTemplateWithItemRefs}</div>
                  <div>Full match by area: {reviewPlanReport.commands.reviewMatchTemplateByArea}</div>
                  <div>
                    Full match by area with item refs:{' '}
                    {reviewPlanReport.commands.reviewMatchTemplateByAreaWithItemRefs}
                  </div>
                </details>
              )}
              {reviewPlanReport.areas.length === 0 ? (
                <div>No unfinished face-audit items.</div>
              ) : (
                <ul>
                  {reviewPlanReport.areas.map((area) => (
                    <li key={area.area}>
                      <div>{faceAuditReviewPlanAreaLabel(area)}</div>
                      <details>
                        <summary>Open plan items</summary>
                        <div>Status: {area.status}; completion: {area.completionStatus}</div>
                        <div>
                          Counts: {area.matchingItemCount} matched,
                          {' '}{area.differenceItemCount} differences,
                          {' '}{area.needsReferenceItemCount} need reference,
                          {' '}{area.unreviewedItemCount} unreviewed
                        </div>
                        {area.evidenceSourceIds.length > 0 && (
                          <div>Evidence sources: {area.evidenceSourceIds.join(', ')}</div>
                        )}
                        <ul>
                          {area.items.map((item) => (
                            <li key={item.key}>
                              <div>{item.key}: {item.reviewStatus}; {item.nextStep}</div>
                              <div>{item.label}</div>
                              {item.expectedFields.length > 0 && (
                                <div>Expected fields: {item.expectedFields.join(', ')}</div>
                              )}
                              {item.evidenceRef.length > 0 && (
                                <div>Evidence ref: {item.evidenceRef}</div>
                              )}
                              {item.notes.length > 0 && (
                                <div>Notes: {item.notes}</div>
                              )}
                            </li>
                          ))}
                        </ul>
                        <div>Template: {area.commands.blankTemplate}</div>
                        <div>Template with sources: {area.commands.blankTemplateWithSources}</div>
                        <div>Area match: {area.commands.areaMatchTemplate}</div>
                        <div>Area match with item refs: {area.commands.areaMatchTemplateWithItemRefs}</div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {reviewHandoffReport && (
            <div>
              <div>Reviewer handoff package</div>
              <div>Artifact: {reviewHandoffReport.artifactType ?? 'unknown'} v{reviewHandoffReport.version ?? '?'}</div>
              {reviewHandoffReport.checklistFingerprint && (
                <div>Checklist: {reviewHandoffReport.checklistFingerprint}</div>
              )}
              {reviewHandoffReport.reviewFingerprint && (
                <div>Review: {reviewHandoffReport.reviewFingerprint}</div>
              )}
              <div>
                Areas: {reviewHandoffReport.pendingAreaCount} unfinished, {reviewHandoffReport.readyAreaCount} ready
              </div>
              {reviewHandoffReport.evidenceSourceCount !== undefined && (
                <div>Evidence sources: {reviewHandoffReport.evidenceSourceCount}</div>
              )}
              <div>Embedded todo areas: {reviewHandoffReport.todo.pendingAreaCount} unfinished</div>
              {reviewHandoffReport.areas.length === 0 ? (
                <div>No unfinished face-audit area artifacts.</div>
              ) : (
                <ul>
                  {reviewHandoffReport.areas.map((area) => (
                    <li key={area.area}>
                      <div>{faceAuditReviewTodoAreaLabel(area.todo)}</div>
                      <div>
                        Area artifact: {area.reviewArtifact.areaItemCount} item(s),
                        {' '}{area.reviewArtifact.evidenceSourceCount} evidence source(s)
                      </div>
                      <button
                        type="button"
                        onClick={() => loadFaceAuditHandoffAreaArtifact(area)}
                      >
                        Load area artifact
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadFaceAuditHandoffAreaArtifact(area)}
                      >
                        Download area artifact
                      </button>
                      <details>
                        <summary>Open handoff details</summary>
                        <div>Status: {area.todo.status}; completion: {area.todo.completionStatus}</div>
                        <div>
                          Counts: {area.todo.matchingItemCount} matched,
                          {' '}{area.todo.differenceItemCount} differences,
                          {' '}{area.todo.needsReferenceItemCount} need reference,
                          {' '}{area.todo.unreviewedItemCount} unreviewed
                        </div>
                        {area.todo.evidenceSourceIds.length > 0 && (
                          <div>Evidence sources: {area.todo.evidenceSourceIds.join(', ')}</div>
                        )}
                        {area.todo.nextItemKeys.length > 0 && (
                          <div>
                            Next item keys: {area.todo.nextItemKeys.join(', ')}
                            {area.todo.remainingItemKeyCount > area.todo.nextItemKeys.length &&
                              `, ${area.todo.remainingItemKeyCount - area.todo.nextItemKeys.length} more`}
                          </div>
                        )}
                        <div>Template: {area.todo.commands.blankTemplate}</div>
                        <div>Template with sources: {area.todo.commands.blankTemplateWithSources}</div>
                        <div>Area match: {area.todo.commands.areaMatchTemplate}</div>
                        <div>Area match with item refs: {area.todo.commands.areaMatchTemplateWithItemRefs}</div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {reviewHandoffResponse && (
            <div>
              <div>Reviewer handoff response</div>
              <div>
                Artifact: {reviewHandoffResponse.artifactType ?? 'unknown'} v{reviewHandoffResponse.version ?? '?'}
              </div>
              {reviewHandoffResponse.checklistFingerprint && (
                <div>Checklist: {reviewHandoffResponse.checklistFingerprint}</div>
              )}
              {reviewHandoffResponse.handoffReviewFingerprint && (
                <div>Handoff review: {reviewHandoffResponse.handoffReviewFingerprint}</div>
              )}
              <div>
                Returned: {reviewHandoffResponse.acceptedAreaCount} /{' '}
                {reviewHandoffResponse.handoffPendingAreaCount} area(s);
                {' '}{reviewHandoffResponse.readyAreaCount} ready,
                {' '}{reviewHandoffResponse.unfinishedReturnedAreaCount} unfinished returned,
                {' '}{reviewHandoffResponse.missingAreaCount} missing,
                {' '}{reviewHandoffResponse.remainingAreaCount} remaining
              </div>
              {reviewHandoffResponse.areas.length === 0 ? (
                <div>No returned handoff area artifacts accepted.</div>
              ) : (
                <ul>
                  {reviewHandoffResponse.areas.map((area) => (
                    <li key={area.area}>
                      <div>
                        {area.area}: {area.completionStatus}; {area.reviewedItemCount} / {area.itemCount} reviewed,
                        {' '}{area.matchingItemCount} matched,
                        {' '}{area.differenceItemCount} differences,
                        {' '}{area.needsReferenceItemCount} need reference,
                        {' '}{area.unreviewedItemCount} unreviewed,
                        {' '}{area.remainingItemCount} remaining,
                        {' '}{area.evidenceRefCount} evidence ref(s)
                      </div>
                      <details>
                        <summary>Open response details</summary>
                        <div>Status: {area.status}</div>
                        <div>
                          Evidence refs: {area.areaLevelEvidenceRefCount} area-level,
                          {' '}{area.itemSpecificEvidenceRefCount} item-specific covering
                          {' '}{area.itemSpecificEvidenceItemCount} item(s)
                        </div>
                        {area.evidenceSourceIds.length > 0 && (
                          <div>Evidence sources: {area.evidenceSourceIds.join(', ')}</div>
                        )}
                        {area.reviewers.length > 0 && (
                          <div>Reviewers: {area.reviewers.join(', ')}</div>
                        )}
                        {area.firstReviewedAt.length > 0 && (
                          <div>Reviewed: {area.firstReviewedAt} - {area.lastReviewedAt}</div>
                        )}
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {reviewTodoReport && visibleReviewTodoIssues.length > 0 && (
            <ul>
              {visibleReviewTodoIssues.map((issue, index) => (
                <li key={`${issue.itemKey ?? 'artifact'}:${issue.field}:${index}`}>
                  {faceAuditReviewIssueLabel(issue)}
                </li>
              ))}
            </ul>
          )}
          {reviewTodoReport && reviewTodoReport.issueCount > visibleReviewTodoIssues.length && (
            <div>{reviewTodoReport.issueCount - visibleReviewTodoIssues.length} more review todo issue(s) omitted.</div>
          )}
          {reviewAreaTodoSummaryReport && visibleReviewAreaTodoSummaryIssues.length > 0 && (
            <ul>
              {visibleReviewAreaTodoSummaryIssues.map((issue, index) => (
                <li key={`${issue.field}-${issue.itemKey ?? 'global'}-${index}`}>
                  {faceAuditReviewIssueLabel(issue)}
                </li>
              ))}
            </ul>
          )}
          {reviewAreaTodoSummaryReport && reviewAreaTodoSummaryReport.issueCount > visibleReviewAreaTodoSummaryIssues.length && (
            <div>
              {reviewAreaTodoSummaryReport.issueCount - visibleReviewAreaTodoSummaryIssues.length}
              {' '}more area todo summary issue(s) omitted.
            </div>
          )}
          {reviewPlanReport && visibleReviewPlanIssues.length > 0 && (
            <ul>
              {visibleReviewPlanIssues.map((issue, index) => (
                <li key={`${issue.itemKey ?? 'artifact'}:${issue.field}:${index}`}>
                  {faceAuditReviewIssueLabel(issue)}
                </li>
              ))}
            </ul>
          )}
          {reviewPlanReport && reviewPlanReport.issueCount > visibleReviewPlanIssues.length && (
            <div>{reviewPlanReport.issueCount - visibleReviewPlanIssues.length} more review plan issue(s) omitted.</div>
          )}
          {reviewHandoffReport && visibleReviewHandoffIssues.length > 0 && (
            <ul>
              {visibleReviewHandoffIssues.map((issue, index) => (
                <li key={`${issue.itemKey ?? 'artifact'}:${issue.field}:${index}`}>
                  {faceAuditReviewIssueLabel(issue)}
                </li>
              ))}
            </ul>
          )}
          {reviewHandoffReport && reviewHandoffReport.issueCount > visibleReviewHandoffIssues.length && (
            <div>{reviewHandoffReport.issueCount - visibleReviewHandoffIssues.length} more reviewer handoff issue(s) omitted.</div>
          )}
          {reviewHandoffValidation && visibleReviewHandoffValidationIssues.length > 0 && (
            <ul>
              {visibleReviewHandoffValidationIssues.map((issue, index) => (
                <li key={`${issue.itemKey ?? 'artifact'}:${issue.field}:${index}`}>
                  {faceAuditReviewIssueLabel(issue)}
                </li>
              ))}
            </ul>
          )}
          {reviewHandoffValidation && reviewHandoffValidation.issueCount > visibleReviewHandoffValidationIssues.length && (
            <div>
              {reviewHandoffValidation.issueCount - visibleReviewHandoffValidationIssues.length}
              {' '}more reviewer handoff validation issue(s) omitted.
            </div>
          )}
          {reviewHandoffResponse && visibleReviewHandoffResponseIssues.length > 0 && (
            <ul>
              {visibleReviewHandoffResponseIssues.map((issue, index) => (
                <li key={`${issue.itemKey ?? 'artifact'}:${issue.field}:${index}`}>
                  {faceAuditReviewIssueLabel(issue)}
                </li>
              ))}
            </ul>
          )}
          {reviewHandoffResponse && reviewHandoffResponse.issueCount > visibleReviewHandoffResponseIssues.length && (
            <div>
              {reviewHandoffResponse.issueCount - visibleReviewHandoffResponseIssues.length}
              {' '}more reviewer handoff response issue(s) omitted.
            </div>
          )}
          {reviewValidation && visibleReviewIssues.length > 0 && (
            <ul>
              {visibleReviewIssues.map((issue, index) => (
                <li key={`${issue.itemKey ?? 'artifact'}:${issue.field}:${index}`}>
                  {faceAuditReviewIssueLabel(issue)}
                </li>
              ))}
            </ul>
          )}
          {reviewValidation && reviewValidation.issueCount > visibleReviewIssues.length && (
            <div>{reviewValidation.issueCount - visibleReviewIssues.length} more review issue(s) omitted.</div>
          )}
          <div>
            <button
              type="button"
              onClick={() => void verifyFaceAuditLockArtifact()}
              disabled={lockArtifactLoading || lockArtifactText.trim().length === 0}
            >
              {lockArtifactLoading ? 'Verifying lock artifact' : 'Verify lock artifact'}
            </button>
            <button
              type="button"
              onClick={() => void checkFaceAuditReleaseGate()}
              disabled={lockArtifactLoading}
            >
              {lockArtifactLoading ? 'Checking release gate' : 'Check release gate'}
            </button>
          </div>
          <label>
            Lock artifact JSON
            <textarea
              rows={8}
              value={lockArtifactText}
              onChange={(event) => {
                setLockArtifactText(event.target.value);
                setLockArtifactValidation(undefined);
                setReleaseGate(undefined);
                setLockArtifactMessage(undefined);
              }}
            />
          </label>
          {lockArtifactMessage && <div>{lockArtifactMessage}</div>}
          {releaseGate && (
            <div>
              Release gate: {releaseGate.pendingAreaCount} pending area(s), {releaseGate.lockedAreaCount} locked area(s)
            </div>
          )}
          {releaseGate && visibleReleaseGateIssues.length > 0 && (
            <ul>
              {visibleReleaseGateIssues.map((issue, index) => (
                <li key={`${issue.itemKey ?? 'artifact'}:${issue.field}:${index}`}>
                  {faceAuditReviewIssueLabel(issue)}
                </li>
              ))}
            </ul>
          )}
          {releaseGate && releaseGate.issueCount > visibleReleaseGateIssues.length && (
            <div>{releaseGate.issueCount - visibleReleaseGateIssues.length} more release gate issue(s) omitted.</div>
          )}
          {lockArtifactValidation && visibleLockArtifactIssues.length > 0 && (
            <ul>
              {visibleLockArtifactIssues.map((issue, index) => (
                <li key={`${issue.itemKey ?? 'artifact'}:${issue.field}:${index}`}>
                  {faceAuditReviewIssueLabel(issue)}
                </li>
              ))}
            </ul>
          )}
          {lockArtifactValidation && lockArtifactValidation.issueCount > visibleLockArtifactIssues.length && (
            <div>{lockArtifactValidation.issueCount - visibleLockArtifactIssues.length} more lock artifact issue(s) omitted.</div>
          )}
          {checklist.areas.map((summary) => {
            const items = faceAuditItemsForArea(checklist, summary.area);
            const areaProgress = faceAuditAreaProgress(checklist, summary, reviewedItemKeys);
            return (
              <details key={summary.area}>
                <summary>{faceAuditAreaSummaryLabel(summary)} - {faceAuditProgressLabel(areaProgress)}</summary>
                <div>Rulebook pages: {summary.rulebookPages.join(', ')}</div>
                <div>Sources: {summary.sourceRefs.join(', ')}</div>
                <div>Tests: {summary.coveredByTests.join(', ')}</div>
                <div>Fields: {faceAuditFieldSummary(summary.expectedFieldNames)}</div>
                <ul>
                  {items.map((item) => (
                    <li key={`${item.area}:${item.id}`}>
                      <label>
                        <input
                          type="checkbox"
                          checked={reviewedItemKeySet.has(faceAuditItemKey(item))}
                          onChange={(event) => updateReviewedItem(item, event.target.checked)}
                        />
                        Reviewed
                      </label>
                      <div><ShortId id={item.id} />: {item.label}</div>
                      <div>{faceAuditFieldSummary(item.expectedFields)}</div>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </>
      )}
    </section>
  );
}

function ConnectionPanel({
  socket,
  onReply,
  onManualJoin,
  assets,
}: {
  socket: Socket;
  onReply: (reply: SocketReply) => void;
  onManualJoin: (playerId?: string) => void;
  assets: OfficialAssets;
}) {
  const [playerCount, setPlayerCount] = useState(2);
  const [playerNames, setPlayerNames] = useState(['Alice', 'Bob']);
  const [introductoryCanalOnly, setIntroductoryCanalOnly] = useState(false);
  const [createSeed, setCreateSeed] = useState('');
  const [joinGameId, setJoinGameId] = useState('');
  const [joinPlayerId, setJoinPlayerId] = useState('');
  const [joinSessionToken, setJoinSessionToken] = useState('');
  const [gameSummaries, setGameSummaries] = useState<GameSummary[]>([]);
  const [gameListError, setGameListError] = useState<string | undefined>();
  const [gameListLoading, setGameListLoading] = useState(false);
  const roomList = listedGames(gameSummaries, sessionsForGame);

  function requestGameList(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      socket.timeout(3000).emit('games:list:get', {}, (error: Error | null, payload: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(payload);
      });
    });
  }

  async function loadGames() {
    setGameListLoading(true);
    setGameListError(undefined);
    try {
      const payload = await requestGameList();
      setGameSummaries(gameSummariesFromPayload(payload));
    } catch (error) {
      setGameListError(error instanceof Error ? error.message : String(error));
    } finally {
      setGameListLoading(false);
    }
  }

  useEffect(() => {
    void loadGames();
  }, []);

  useEffect(() => {
    const updateGameSummaries = (payload: unknown) => {
      setGameSummaries(gameSummariesFromPayload(payload));
    };
    socket.on('games:list', updateGameSummaries);
    return () => {
      socket.off('games:list', updateGameSummaries);
    };
  }, [socket]);

  function updatePlayerCount(nextCount: number) {
    setPlayerCount(nextCount);
    setPlayerNames((names) => playerNamesForCount(names, nextCount));
  }

  function create(event: FormEvent) {
    event.preventDefault();
    const result = createGamePayload(playerNames, introductoryCanalOnly, createSeed);
    if (!result.ok) {
      onReply({ ok: false, errors: [result.error] });
      return;
    }
    socket.emit('game:create', result.payload, onReply);
  }

  function join(event: FormEvent) {
    event.preventDefault();
    const result = joinGamePayload(joinGameId, joinPlayerId, joinSessionToken);
    if (!result.ok) {
      onReply({ ok: false, errors: [result.error] });
      return;
    }
    socket.emit('game:join', result.payload, (reply: SocketReply) => {
      onReply(reply);
      const viewerUpdate = manualJoinViewerUpdate(reply, result.payload.playerId);
      if (viewerUpdate.apply) {
        onManualJoin(viewerUpdate.playerId);
      }
    });
  }

  function observeGame(gameId: string) {
    const result = joinGamePayload(gameId);
    if (!result.ok) {
      onReply({ ok: false, errors: [result.error] });
      return;
    }
    setJoinGameId(gameId);
    setJoinPlayerId('');
    setJoinSessionToken('');
    socket.emit('game:join', result.payload, (reply: SocketReply) => {
      onReply(reply);
      const viewerUpdate = manualJoinViewerUpdate(reply);
      if (viewerUpdate.apply) {
        onManualJoin(viewerUpdate.playerId);
      }
    });
  }

  function joinSavedGameSession(gameId: string, session: PlayerSession) {
    const result = joinGamePayload(gameId, session.playerId, session.token);
    if (!result.ok) {
      onReply({ ok: false, errors: [result.error] });
      return;
    }
    setJoinGameId(gameId);
    setJoinPlayerId(session.playerId);
    setJoinSessionToken(session.token);
    socket.emit('game:join', result.payload, (reply: SocketReply) => {
      onReply(reply);
      const viewerUpdate = manualJoinViewerUpdate(reply, session.playerId);
      if (viewerUpdate.apply) {
        onManualJoin(viewerUpdate.playerId);
      }
    });
  }

  const boardUrl = officialAssetUrl(assets, 'source.board', 'game-board');

  return (
    <section className="lobby-shell">
      <div className="lobby-board">
        {boardUrl
          ? <img src={boardUrl} alt="Brass Birmingham board" />
          : <div className="image-placeholder">Official board image unavailable</div>}
      </div>
      <div className="lobby-controls">
        <div className="panel-heading">
          <p className="eyebrow">Start</p>
          <h2>Room</h2>
        </div>
        <form className="control-card" onSubmit={create}>
          <div className="form-grid form-grid-compact">
            <label>
              Players
              <select value={playerCount} onChange={(event) => updatePlayerCount(Number(event.target.value))}>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
            <label>
              Seed
              <input
                value={createSeed}
                onChange={(event) => setCreateSeed(event.target.value)}
                placeholder="optional integer"
              />
            </label>
          </div>
          <div className="form-grid">
            {playerNames.map((name, index) => (
              <label key={index}>
                Player {index + 1}
                <input
                  value={name}
                  onChange={(event) => setPlayerNames((names) => names.map((current, nameIndex) => nameIndex === index ? event.target.value : current))}
                />
              </label>
            ))}
          </div>
          <label className="checkbox-row toggle-row">
            <input
              type="checkbox"
              checked={introductoryCanalOnly}
              onChange={(event) => setIntroductoryCanalOnly(event.target.checked)}
            />
            <span>Introductory Canal-only game</span>
          </label>
          <button className="primary-button" type="submit">Create Game</button>
        </form>
        <form className="control-card" onSubmit={join}>
          <h3>Join by ID</h3>
          <div className="form-grid">
            <label>
              Game ID
              <input value={joinGameId} onChange={(event) => setJoinGameId(event.target.value)} />
            </label>
            <label>
              Player ID
              <input value={joinPlayerId} onChange={(event) => setJoinPlayerId(event.target.value)} placeholder="p1" />
            </label>
            <label>
              Session token
              <input value={joinSessionToken} onChange={(event) => setJoinSessionToken(event.target.value)} />
            </label>
          </div>
          <button type="submit">Join Game</button>
        </form>
        <RoomList
          games={roomList}
          loading={gameListLoading}
          error={gameListError}
          onRefresh={() => void loadGames()}
          onObserve={observeGame}
          onJoinSession={joinSavedGameSession}
        />
      </div>
    </section>
  );
}

function RoomList({
  games,
  loading,
  error,
  onRefresh,
  onObserve,
  onJoinSession,
}: {
  games: ListedGame[];
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onObserve: (gameId: string) => void;
  onJoinSession: (gameId: string, session: PlayerSession) => void;
}) {
  return (
    <section className="room-list">
      <div className="section-heading-row">
        <h3>Existing Games</h3>
        <button type="button" onClick={onRefresh} disabled={loading}>{loading ? 'Loading games' : 'Refresh games'}</button>
      </div>
      {error && <div className="inline-error">{error}</div>}
      {games.length === 0 ? <div className="empty-state">No games listed.</div> : games.map((game) => {
        const roomLabel = labelWithAbbreviatedId(game.label, game.id);
        return (
          <div className="room-card" key={game.id}>
            <div>
              <strong title={roomLabel === game.label ? undefined : game.label}>{roomLabel}</strong>
              <div className="muted-text"><ShortId id={game.id} /></div>
            </div>
            <div className="button-row">
              <button type="button" onClick={() => onObserve(game.id)}>Observe</button>
              {game.savedSessions.map((session) => {
                const sessionLabel = savedSessionLabel(game, session);
                const visibleSessionLabel = labelWithAbbreviatedId(sessionLabel, game.id);
                return (
                  <button
                    key={session.playerId}
                    type="button"
                    onClick={() => onJoinSession(game.id, session)}
                    title={visibleSessionLabel === sessionLabel ? undefined : sessionLabel}
                  >
                    {visibleSessionLabel}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function GameView({
  game,
  knownSessions,
  viewerPlayerId,
  sendCommand,
  joinSession,
  leaveRoom,
  assets,
}: {
  game: GameState;
  knownSessions: PlayerSession[];
  viewerPlayerId?: string;
  sendCommand: (command: GameCommand) => void;
  joinSession: (session: PlayerSession) => void;
  leaveRoom: () => void;
  assets: OfficialAssets;
}) {
  const pendingDecisionPlayerId = pendingDecisionPlayerIdForView(game);
  const activePlayerId = activePlayerIdForView(game);
  const handPlayerId = handPlayerIdForView(game, viewerPlayerId);
  const canSubmitForActivePlayer = canSubmitForActivePlayerView(game, knownSessions);
  const gameEnded = game.status === 'ended';
  const [boardBuildOverlay, setBoardBuildOverlay] = useState<BoardBuildOverlayState>(emptyBoardBuildOverlayState);
  const [boardBuildSelectionRequest, setBoardBuildSelectionRequest] = useState<BoardBuildSelectionRequest>();
  const handleBoardBuildOverlayChange = useCallback((overlay: BoardBuildOverlayState) => {
    setBoardBuildOverlay(overlay);
  }, []);
  const handleBoardBuildRegionSelect = useCallback((option: BoardBuildRegionOption) => {
    const selectedIndustryType = boardBuildOverlay.selectedIndustryType;
    const industryType = selectedIndustryType && option.industryTypes.includes(selectedIndustryType)
      ? selectedIndustryType
      : option.industryTypes[0];
    if (!industryType || !boardBuildOverlay.playerId || !boardBuildOverlay.cardId) {
      return;
    }
    setBoardBuildSelectionRequest((current) => ({
      requestId: (current?.requestId ?? 0) + 1,
      playerId: boardBuildOverlay.playerId,
      cardId: boardBuildOverlay.cardId,
      locationId: option.locationId,
      slotId: option.slotId,
      industryType,
    }));
  }, [boardBuildOverlay.cardId, boardBuildOverlay.playerId, boardBuildOverlay.selectedIndustryType]);

  return (
    <section className="game-table">
      <div className="game-topbar">
        <div>
          <p className="eyebrow">Game <ShortId id={game.id} /></p>
          <h2>{game.era === 'canal' ? 'Canal Era' : 'Rail Era'} · Round {game.roundNumber}</h2>
        </div>
        <div className="turn-summary">
          {!gameEnded && (
            <>
              <span>{pendingDecisionPlayerId ? 'Pending' : 'Current'}: {playerLabelForView(game, activePlayerId)}</span>
              <span>Viewing: {playerLabelForView(game, handPlayerId)}</span>
              <span>Action {game.actionIndexInTurn + 1} / {game.actionsAllowedThisTurn}</span>
            </>
          )}
          <button type="button" onClick={leaveRoom}>Leave room</button>
        </div>
      </div>
      <div className="game-workspace">
        <aside className="left-rail">
          <PlayersTable game={game} assets={assets} />
          <SessionSummary game={game} knownSessions={knownSessions} viewerPlayerId={handPlayerId} joinSession={joinSession} />
          <LastEraScore game={game} />
        </aside>
        <div className="board-column">
          <BoardSummary
            game={game}
            assets={assets}
            buildOverlay={boardBuildOverlay}
            onBuildRegionSelect={handleBoardBuildRegionSelect}
          />
          <EventLog game={game} />
        </div>
        <aside className="action-rail">
          {gameEnded ? (
            <GameOverSummary game={game} />
          ) : (
            <>
              <HandPanel game={game} playerId={handPlayerId} assets={assets} />
              {canSubmitForActivePlayer
                ? (pendingDecisionPlayerId
                  ? <PendingDecisionPanel game={game} sendCommand={sendCommand} />
                  : (
                    <ActionForms
                      game={game}
                      playerId={activePlayerId}
                      sendCommand={sendCommand}
                      assets={assets}
                      boardBuildSelectionRequest={boardBuildSelectionRequest}
                      onBoardBuildOverlayChange={handleBoardBuildOverlayChange}
                    />
                  ))
                : <div className="notice-panel">Join with the saved session for {activePlayerId} to submit actions.</div>}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

interface BoardBuildRegionOption {
  slotId: string;
  locationId: string;
  industryTypes: IndustryType[];
}

interface BoardBuildOverlayState {
  active: boolean;
  playerId: string;
  cardId: string;
  selectedSlotId: string;
  selectedIndustryType: IndustryType | '';
  options: BoardBuildRegionOption[];
}

interface BoardBuildSelectionRequest {
  requestId: number;
  playerId: string;
  cardId: string;
  locationId: string;
  slotId: string;
  industryType: IndustryType;
}

const emptyBoardBuildOverlayState: BoardBuildOverlayState = {
  active: false,
  playerId: '',
  cardId: '',
  selectedSlotId: '',
  selectedIndustryType: '',
  options: [],
};

function GameOverSummary({ game }: { game: GameState }) {
  const gameEndedEvent = [...game.eventLog].reverse().find((event) => event.type === 'game_ended');
  const winners = gameEndedEvent?.type === 'game_ended' ? gameEndedEvent.winners : [];

  return (
    <section className="control-card">
      <h3>Game Over</h3>
      <div>
        Winner{winners.length === 1 ? '' : 's'}: {winners.length > 0
          ? winners.map((playerId) => playerLabelForView(game, playerId)).join(', ')
          : 'unknown'}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>VP</th>
              <th>Income position</th>
              <th>Cash</th>
            </tr>
          </thead>
          <tbody>
            {game.turnOrder.map((playerId) => {
              const row = playerTableRowForView(game, playerId);
              return (
                <tr key={playerId}>
                  <td>{playerLabelForView(game, playerId)}</td>
                  <td>{row.victoryPoints}</td>
                  <td>{row.incomeTrackPosition}</td>
                  <td>{row.cash}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LastEraScore({ game }: { game: GameState }) {
  const score = game.lastEraScore;
  return (
    <section className="control-card compact-panel">
      <h3>Last Era Score</h3>
      {!score ? <div>No era has been scored yet.</div> : (
        <div className="table-scroll">
          <div>Era: {score.era}</div>
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Links</th>
                <th>Industries</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {game.turnOrder.map((playerId) => (
                <tr key={playerId}>
                  <td>{playerLabelForView(game, playerId)}</td>
                  <td>{score.linkVictoryPointsByPlayer[playerId] ?? 0}</td>
                  <td>{score.industryVictoryPointsByPlayer[playerId] ?? 0}</td>
                  <td>{score.totalVictoryPointsByPlayer[playerId] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SessionSummary({
  game,
  knownSessions,
  viewerPlayerId,
  joinSession,
}: {
  game: GameState;
  knownSessions: PlayerSession[];
  viewerPlayerId?: string;
  joinSession: (session: PlayerSession) => void;
}) {
  const sessionByPlayer = new Map(normalizedSessionsForView(knownSessions).map((session) => [session.playerId, session]));
  const baseUrl = window.location.href;
  return (
    <details className="control-card compact-panel">
      <summary>Saved Sessions</summary>
      {game.turnOrder.map((playerId) => {
        const session = sessionByPlayer.get(playerId);
        return (
          <div className="session-row" key={playerId}>
            <div>
              <strong><ShortId id={playerId} /></strong>: {session ? 'token saved' : 'no token saved'}
              {viewerPlayerId === playerId && <span className="muted-text"> (viewing)</span>}
            </div>
            {session && (
              <button type="button" onClick={() => joinSession(session)}>
                Use <ShortId id={playerId} /> session
              </button>
            )}
            {session && (
              <label>
                Join link
                <input readOnly value={playerSessionUrl(baseUrl, game.id, session)} />
              </label>
            )}
          </div>
        );
      })}
    </details>
  );
}

function PlayersTable({ game, assets }: { game: GameState; assets: OfficialAssets }) {
  const activeLinkType = game.era === 'canal' ? 'canal' : 'rail';
  const activeLinkLabel = game.era === 'canal' ? 'canal links left' : 'rail links left';
  return (
    <section className="scoreboard">
      <h3>Players</h3>
      <div className="player-stack">
        {game.turnOrder.map((playerId, index) => {
          const row = playerTableRowForView(game, playerId);
          const player = game.players[playerId];
          const builtIndustries = builtIndustriesForPlayer(game, playerId);
          const builtCounts = builtIndustryCounts(builtIndustries);
          return (
            <div className="player-card" key={row.id} style={{ '--player-accent': playerAccent(index, player.color) } as React.CSSProperties}>
              <div>
                <strong>{row.name}</strong>
                <ShortId id={row.id} className="muted-text" />
              </div>
              <div className="metric-grid">
                <span><b>{row.cash}</b> cash</span>
                <span><b>{row.incomeLevel}</b> income</span>
                <span><b>{row.victoryPoints}</b> VP</span>
                <span><b>{row.handCount}</b> hand</span>
              </div>
              <div className="link-stock-grid" aria-label={`${row.name} remaining links`}>
                <span><b>{player.remainingLinks[activeLinkType]}</b> {activeLinkLabel}</span>
              </div>
              <div className="industry-counts" aria-label={`${row.name} built industries`}>
                {industryTypeOrder.map((industryType) => (
                  <span key={industryType}>
                    {shortIndustryLabel(industryType)} <b>{builtCounts[industryType] ?? 0}</b>
                  </span>
                ))}
              </div>
              <PlayerIndustryTileStock player={player} assets={assets} />
              <div className="spent-chip">spent {row.spentThisRound}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const playerColorAccents: Record<PlayerColor, string> = {
  orange: '#c2410c',
  yellow: '#ca8a04',
  purple: '#7e22ce',
  teal: '#0f766e',
};

function playerAccent(index: number, color?: PlayerColor): string {
  return color ? playerColorAccents[color] : ['#c2410c', '#ca8a04', '#7e22ce', '#0f766e'][index % 4];
}

function industryLabel(industryType: IndustryType): string {
  return industryType.replace(/_/g, ' ');
}

const industryTypeOrder: IndustryType[] = [
  'cotton_mill',
  'coal_mine',
  'iron_works',
  'manufacturer',
  'pottery',
  'brewery',
];

function shortIndustryLabel(industryType: IndustryType): string {
  const labels: Record<IndustryType, string> = {
    cotton_mill: 'cotton',
    coal_mine: 'coal',
    iron_works: 'iron',
    manufacturer: 'goods',
    pottery: 'pottery',
    brewery: 'beer',
  };
  return labels[industryType];
}

function builtIndustriesForPlayer(game: GameState, playerId: string): GameState['board']['industryInstances'][string][] {
  return getActiveIndustries(game).filter((industry) => industry.ownerPlayerId === playerId);
}

function builtIndustryCounts(
  industries: GameState['board']['industryInstances'][string][],
): Partial<Record<IndustryType, number>> {
  return industries.reduce<Partial<Record<IndustryType, number>>>((counts, industry) => {
    counts[industry.industryType] = (counts[industry.industryType] ?? 0) + 1;
    return counts;
  }, {});
}

type IndustryTileStockGroup = {
  industryType: IndustryType;
  level: number;
  representativeSpecId: string;
  remainingCount: number;
  totalCount: number;
};

function industryTileStockGroupsForPlayer(player: GameState['players'][string]): IndustryTileStockGroup[] {
  const remainingCounts = new Map<string, number>();

  for (const stack of Object.values(player.industryTileStacks)) {
    for (const specId of stack.availableSpecIdsInOrder) {
      const spec = staticConfig.industryTileSpecs[specId];
      if (!spec) {
        continue;
      }
      const key = `${spec.industryType}:${spec.level}`;
      remainingCounts.set(key, (remainingCounts.get(key) ?? 0) + 1);
    }
  }

  return industryTypeOrder.flatMap((industryType) => {
    const specIdsByLevel = new Map<number, string[]>();
    for (const specId of staticConfig.industryStackSpecIds[industryType] ?? []) {
      const spec = staticConfig.industryTileSpecs[specId];
      if (!spec) {
        continue;
      }
      specIdsByLevel.set(spec.level, [...(specIdsByLevel.get(spec.level) ?? []), specId]);
    }
    return [...specIdsByLevel.entries()]
      .sort(([levelA], [levelB]) => levelA - levelB)
      .map(([level, specIds]) => ({
        industryType,
        level,
        representativeSpecId: specIds[0],
        remainingCount: remainingCounts.get(`${industryType}:${level}`) ?? 0,
        totalCount: specIds.length,
      }));
  });
}

function PlayerIndustryTileStock({
  player,
  assets,
}: {
  player: GameState['players'][string];
  assets: OfficialAssets;
}) {
  const stockGroups = industryTileStockGroupsForPlayer(player);
  return (
    <div className="industry-stock-panel">
      <div className="section-heading-row">
        <strong>Industry tiles left</strong>
        <span className="muted-text">left / total</span>
      </div>
      <div className="industry-stock-grid">
        {stockGroups.map((group) => {
          const imageUrl = officialIndustryTileUrl(assets, group.representativeSpecId, false, player.color);
          return (
            <div className="industry-stock-item" key={`${group.industryType}-${group.level}`}>
              {imageUrl
                ? <img src={imageUrl} alt={`${group.industryType} level ${group.level}`} />
                : <div className="tile-fallback">L{group.level}</div>}
              <div>
                <strong>{shortIndustryLabel(group.industryType)} L{group.level}</strong>
                <span><b>{group.remainingCount}</b> / {group.totalCount}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IndustryTileCard({
  game,
  industry,
  assets,
}: {
  game: GameState;
  industry: GameState['board']['industryInstances'][string];
  assets: OfficialAssets;
}) {
  const ownerColor = game.players[industry.ownerPlayerId]?.color;
  const imageUrl = officialIndustryTileUrl(assets, industry.specId, industry.flipped, ownerColor);
  const playerIndex = game.turnOrder.indexOf(industry.ownerPlayerId);
  return (
    <div className="tile-card" style={{ '--player-accent': playerAccent(playerIndex, ownerColor) } as React.CSSProperties}>
      {imageUrl
        ? <img src={imageUrl} alt={`${industry.industryType} level ${industry.level}`} />
        : <div className="tile-fallback">L{industry.level}</div>}
      <div>
        <strong>{industryLabel(industry.industryType)}</strong>
        <ShortId id={industry.locationId} />
        <span>{industry.flipped ? 'flipped' : `resource ${industry.remainingResource}`}</span>
      </div>
    </div>
  );
}

function PlayerIndustryStatus({ game, assets }: { game: GameState; assets: OfficialAssets }) {
  return (
    <div className="player-industry-status">
      <div className="section-heading-row">
        <h3>Player Industry Status</h3>
        <span className="muted-text">by player</span>
      </div>
      <div className="player-industry-grid">
        {game.turnOrder.map((playerId, index) => {
          const industries = builtIndustriesForPlayer(game, playerId);
          return (
            <div className="player-industry-card" key={playerId} style={{ '--player-accent': playerAccent(index, game.players[playerId]?.color) } as React.CSSProperties}>
              <div className="section-heading-row">
                <strong>{playerLabelForView(game, playerId)}</strong>
                <span className="muted-text">{industries.length} built</span>
              </div>
              {industries.length === 0 ? (
                <div className="empty-state compact-empty">No industries built.</div>
              ) : (
                <div className="mini-tile-list">
                  {industries.map((industry) => (
                    <IndustryTileCard key={industry.id} game={game} industry={industry} assets={assets} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MerchantTilesPanel({ game, assets }: { game: GameState; assets: OfficialAssets }) {
  const merchantSpaces = Object.values(game.board.merchantSpaces)
    .filter((space) => space.merchantTileInstanceId);
  return (
    <div className="merchant-panel">
      <div className="section-heading-row">
        <h3>Merchants</h3>
        <span className="muted-text">{merchantSpaces.length}</span>
      </div>
      {merchantSpaces.length === 0 ? <div className="empty-state">No merchant tiles.</div> : (
        <div className="merchant-grid">
          {merchantSpaces.map((space) => {
            const imageUrl = officialMerchantTileUrl(assets, space.merchantTileInstanceId);
            return (
              <div className="merchant-card" key={space.id}>
                {imageUrl && <img src={imageUrl} alt={space.merchantTileInstanceId} />}
                <div>
                  <strong><ShortId id={space.id} /></strong>
                  <span>{space.beerPresent ? 'beer' : 'no beer'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function boardRegionStyle(region: BoardSlotRegion): React.CSSProperties {
  return {
    left: `${region.left}%`,
    top: `${region.top}%`,
    width: `${region.width}%`,
    height: `${region.height}%`,
  };
}

function BoardSummary({
  game,
  assets,
  buildOverlay,
  onBuildRegionSelect,
}: {
  game: GameState;
  assets: OfficialAssets;
  buildOverlay?: BoardBuildOverlayState;
  onBuildRegionSelect?: (option: BoardBuildRegionOption) => void;
}) {
  const industries = getActiveIndustries(game);
  const links = getActiveLinks(game);
  const coalMarketCubes = marketOccupiedCount(game, 'coal');
  const ironMarketCubes = marketOccupiedCount(game, 'iron');
  const boardUrl = officialAssetUrl(assets, 'source.board', 'game-board');
  const buildRegionOptions = buildOverlay?.active
    ? buildOverlay.options.filter((option) => BOARD_SLOT_REGIONS[option.slotId])
    : [];

  function activateBuildRegion(event: React.KeyboardEvent<HTMLDivElement>, option: BoardBuildRegionOption) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    onBuildRegionSelect?.(option);
  }

  return (
    <section className="board-panel">
      <div className="board-stage">
        {boardUrl
          ? <img className="board-image" src={boardUrl} alt="Official Brass Birmingham board" />
          : <div className="image-placeholder">Official board image unavailable</div>}
        <div className="board-built-layer" aria-label="Built industries on board">
          {industries.map((industry) => {
            const region = BOARD_SLOT_REGIONS[industry.slotId];
            if (!region) {
              return null;
            }
            const owner = game.players[industry.ownerPlayerId];
            const imageUrl = officialIndustryTileUrl(assets, industry.specId, industry.flipped, owner?.color);
            const locationName = staticConfig.locations[industry.locationId]?.name ?? abbreviatedId(industry.locationId);
            const title = `${owner?.name ?? abbreviatedId(industry.ownerPlayerId)} ${industryLabel(industry.industryType)} at ${locationName}`;
            return (
              <div className="board-built-industry" key={industry.id} style={boardRegionStyle(region)} title={title}>
                {imageUrl
                  ? <img src={imageUrl} alt={`${title}, ${industry.flipped ? 'flipped' : 'front'}`} />
                  : <span>{industry.level}</span>}
              </div>
            );
          })}
        </div>
        {buildRegionOptions.length > 0 && (
          <div className="board-build-layer" aria-label="Selectable build spaces">
            {buildRegionOptions.map((option) => {
              const region = BOARD_SLOT_REGIONS[option.slotId];
              const locationName = staticConfig.locations[option.locationId]?.name ?? abbreviatedId(option.locationId);
              const industriesLabel = option.industryTypes.map(industryLabel).join(', ');
              const title = `${locationName}: ${industriesLabel} (${option.slotId})`;
              const isSelected = option.slotId === buildOverlay?.selectedSlotId;
              return (
                <div
                  key={option.slotId}
                  className={`board-build-region${isSelected ? ' is-selected' : ''}`}
                  style={boardRegionStyle(region)}
                  role="button"
                  tabIndex={0}
                  title={title}
                  aria-label={`Build at ${title}`}
                  onClick={() => onBuildRegionSelect?.(option)}
                  onKeyDown={(event) => activateBuildRegion(event, option)}
                >
                  <span>{abbreviatedId(option.slotId)}</span>
                </div>
              );
            })}
          </div>
        )}
        <div className="market-strip">
          <span>Coal market {coalMarketCubes}</span>
          <span>Iron market {ironMarketCubes}</span>
          <span>{industries.length} industries</span>
          <span>{links.length} links</span>
        </div>
      </div>
      <div className="board-details">
        <div className="section-heading-row">
          <h3>Built Industries</h3>
          <span className="muted-text">{industries.length}</span>
        </div>
        {industries.length === 0 ? <div className="empty-state">No industries built.</div> : (
          <div className="tile-grid">
            {industries.map((industry) => (
              <IndustryTileCard key={industry.id} game={game} industry={industry} assets={assets} />
            ))}
          </div>
        )}
        <PlayerIndustryStatus game={game} assets={assets} />
        <div className="section-heading-row">
          <h3>Links</h3>
          <span className="muted-text">{links.length}</span>
        </div>
        {links.length === 0 ? <div className="empty-state">No links built.</div> : (
          <div className="link-list">
            {links.map((link) => (
              <div className="link-card" key={link.id}>
                <ShortId id={link.ownerPlayerId} />
                <strong>{link.linkType}</strong>
                <ShortId id={link.linkLineId} />
              </div>
            ))}
          </div>
        )}
        <MerchantTilesPanel game={game} assets={assets} />
      </div>
    </section>
  );
}

function CardThumb({
  assets,
  cardId,
  selected = false,
  onClick,
}: {
  assets: OfficialAssets;
  cardId: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const card = staticConfig.cardSpecs[cardId];
  const imageUrl = officialCardUrl(assets, cardId);
  const className = `card-thumb${selected ? ' is-selected' : ''}${onClick ? ' is-clickable' : ''}`;
  const content = (
    <>
      {imageUrl
        ? <img src={imageUrl} alt={card?.name ?? cardId} />
        : <div className="card-fallback">{isHiddenCardId(cardId) ? 'Hidden card' : (card?.name ?? cardId)}</div>}
      <span>{isHiddenCardId(cardId) ? 'Hidden' : (card?.name ?? cardId)}</span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

function HandPanel({ game, playerId, assets }: { game: GameState; playerId: string; assets: OfficialAssets }) {
  const handCardIds = playerHandCardIdsForView(game, playerId);
  return (
    <section className="hand-panel">
      <div className="section-heading-row">
        <h3>{playerLabelForView(game, playerId)} Hand</h3>
        <span className="muted-text">{handCardIds.length} cards</span>
      </div>
      {handCardIds.length === 0 && <div className="empty-state">No visible hand cards.</div>}
      <div className="hand-strip">
        {handCardIds.map((cardId) => <CardThumb key={cardId} assets={assets} cardId={cardId} />)}
      </div>
    </section>
  );
}

function PendingDecisionPanel({ game, sendCommand }: { game: GameState; sendCommand: (command: GameCommand) => void }) {
  const decision = game.pendingDecision;
  const [selectedIndustryIds, setSelectedIndustryIds] = useState<string[]>([]);
  const [selectedDevelopTypes, setSelectedDevelopTypes] = useState<IndustryType[]>([]);
  const decisionKey = decision
    ? decision.type === 'negative_income'
      ? `${game.id}:${game.roundNumber}:${decision.type}:${decision.playerId}:${decision.amountOwed}:${decision.incomePlayerIndex}`
      : `${game.id}:${game.roundNumber}:${decision.type}:${decision.playerId}:${merchantDevelopSourceLabel(decision)}:${decision.count}`
    : game.id;

  useEffect(() => {
    setSelectedIndustryIds([]);
    setSelectedDevelopTypes([]);
  }, [decisionKey]);

  if (!decision) {
    return null;
  }

  const playerId = decision.playerId;
  const player = game.players[playerId];

  if (decision.type === 'merchant_develop') {
    const selectedTypes = normalizeDevelopSelections(player, selectedDevelopTypes, decision.count);
    const merchantDevelopReason = resolveMerchantDevelopDecisionReason(game, playerId, selectedTypes);
    const merchantDevelopCanSubmit = !merchantDevelopReason;

    function setDevelopType(index: number, industryType: IndustryType) {
      setSelectedDevelopTypes((current) => {
        const next = [...selectedTypes];
        next[index] = industryType;
        return next;
      });
    }

    function submitMerchantDevelop(event: FormEvent) {
      event.preventDefault();
      if (!merchantDevelopCanSubmit) {
        return;
      }
      sendCommand({
        type: 'resolve_merchant_develop',
        playerId,
        industryTypes: selectedTypes,
      });
    }

    return (
      <section>
        <h3>Merchant Develop Decision</h3>
        <div>{player.name} may develop {decision.count} tile{decision.count === 1 ? '' : 's'} from {merchantDevelopSourceLabel(decision)}.</div>
        <form onSubmit={submitMerchantDevelop}>
          {selectedTypes.length === 0 && <div>No developable tiles remain.</div>}
          {selectedTypes.map((selectedType, index) => (
            <label key={index}>
              Develop tile {index + 1}
              <select value={selectedType} onChange={(event) => setDevelopType(index, event.target.value as IndustryType)}>
                {developOptionsForSelect(player, selectedTypes, index).map((industryType) => {
                  const offset = selectedTypes.slice(0, index).filter((selected) => selected === industryType).length;
                  const specId = player.industryTileStacks[industryType]?.availableSpecIdsInOrder[offset];
                  const spec = specId ? staticConfig.industryTileSpecs[specId] : undefined;
                  return <option key={industryType} value={industryType}>{industryType}: {specId} L{spec?.level ?? '?'}</option>;
                })}
              </select>
            </label>
          ))}
          <button type="submit" disabled={!merchantDevelopCanSubmit} title={merchantDevelopReason}>Resolve merchant develop</button>
          <ActionReason reason={merchantDevelopReason} />
        </form>
      </section>
    );
  }

  const amountOwed = decision.amountOwed;
  const removableIndustries = negativeIncomeIndustryOptions(game, playerId);
  const selectedValue = selectedIndustryIds.reduce((total, industryInstanceId) => {
    const industry = game.board.industryInstances[industryInstanceId];
    return industry ? total + industryLiquidationValue(industry) : total;
  }, 0);
  const projectedCash = player.cash + selectedValue;
  const shortfallAfterSelection = Math.max(0, amountOwed - projectedCash);
  const negativeIncomeReason = resolveNegativeIncomeDecisionReason(game, playerId, selectedIndustryIds);
  const negativeIncomeCanSubmit = !negativeIncomeReason;

  function toggleIndustry(industryInstanceId: string, checked: boolean) {
    setSelectedIndustryIds((current) => checked
      ? [...current, industryInstanceId]
      : current.filter((id) => id !== industryInstanceId));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!negativeIncomeCanSubmit) {
      return;
    }
    sendCommand({
      type: 'resolve_negative_income',
      playerId,
      industryInstanceIds: selectedIndustryIds,
    });
  }

  return (
    <section>
      <h3>Negative Income Decision</h3>
      <div>{player.name} owes {amountOwed}. Cash: {player.cash}.</div>
      <form onSubmit={submit}>
        {removableIndustries.length === 0 ? <div>No industries available to liquidate.</div> : removableIndustries.map((industry) => (
          <label key={industry.id} className="checkbox-row">
            <input
              type="checkbox"
              checked={selectedIndustryIds.includes(industry.id)}
              onChange={(event) => toggleIndustry(industry.id, event.target.checked)}
            />
            <span>
              <ShortId id={industry.id} />: {industry.industryType} L{industry.level} at <ShortId id={industry.locationId} />, value {industryLiquidationValue(industry)}
              {selectedIndustryIds.includes(industry.id) ? `, order ${selectedIndustryIds.indexOf(industry.id) + 1}` : ''}
            </span>
          </label>
        ))}
        <div>Selected liquidation value: {selectedValue}</div>
        <div>Cash after liquidation: {projectedCash}</div>
        <div>VP loss after payment: {shortfallAfterSelection}</div>
        <button type="submit" disabled={!negativeIncomeCanSubmit} title={negativeIncomeReason}>Resolve negative income</button>
        <ActionReason reason={negativeIncomeReason} />
      </form>
    </section>
  );
}

function ActionReason({ reason }: { reason?: string }) {
  return reason ? <div className="action-reason">{reason}</div> : null;
}

type ActionTab = 'build' | 'network' | 'develop' | 'sell' | 'loan' | 'scout' | 'pass';

function ActionForms({
  game,
  playerId,
  sendCommand,
  assets,
  boardBuildSelectionRequest,
  onBoardBuildOverlayChange,
}: {
  game: GameState;
  playerId: string;
  sendCommand: (command: GameCommand) => void;
  assets: OfficialAssets;
  boardBuildSelectionRequest?: BoardBuildSelectionRequest;
  onBoardBuildOverlayChange?: (overlay: BoardBuildOverlayState) => void;
}) {
  const player = game.players[playerId];
  const handCardIds = useMemo(() => playerHandCardIdsForView(game, playerId), [game, playerId]);
  const firstCard = handCardIds[0] ?? '';
  const [cardId, setCardId] = useState(firstCard);
  const [selectedAction, setSelectedAction] = useState<ActionTab>('build');
  const [scoutCardOne, setScoutCardOne] = useState(handCardIds[0] ?? '');
  const [scoutCardTwo, setScoutCardTwo] = useState(handCardIds[1] ?? '');
  const [scoutCardThree, setScoutCardThree] = useState(handCardIds[2] ?? '');
  const [locationId, setLocationId] = useState('birmingham');
  const [slotId, setSlotId] = useState('birmingham-0');
  const [industryType, setIndustryType] = useState<IndustryType | ''>('manufacturer');
  const [linkLineId, setLinkLineId] = useState('birmingham-walsall');
  const [secondLinkLineId, setSecondLinkLineId] = useState('');
  const [developOne, setDevelopOne] = useState<IndustryType | ''>('coal_mine');
  const [developTwo, setDevelopTwo] = useState<IndustryType | ''>('');
  const [sellSteps, setSellSteps] = useState<SellStepDraft[]>([createSellStepDraft()]);
  const [buildCoalOne, setBuildCoalOne] = useState('');
  const [buildCoalTwo, setBuildCoalTwo] = useState('');
  const [buildIronOne, setBuildIronOne] = useState('');
  const [buildIronTwo, setBuildIronTwo] = useState('');
  const [developIronOne, setDevelopIronOne] = useState('');
  const [developIronTwo, setDevelopIronTwo] = useState('');
  const [networkCoalOne, setNetworkCoalOne] = useState('');
  const [networkCoalTwo, setNetworkCoalTwo] = useState('');
  const [networkBeerSource, setNetworkBeerSource] = useState('');
  const scoutCards = [scoutCardOne, scoutCardTwo, scoutCardThree];
  const scoutAllowed = canScout(game, playerId);
  const scoutCardOptions = scoutCards.map((_, index) => scoutCardOptionsForSelect(game, playerId, scoutCards, index));
  const normalizedScoutCards = normalizeScoutCardSelection(game, playerId, scoutCards);
  const normalizedScoutOne = normalizedScoutCards[0] ?? '';
  const normalizedScoutTwo = normalizedScoutCards[1] ?? '';
  const normalizedScoutThree = normalizedScoutCards[2] ?? '';

  useEffect(() => {
    if (!handCardIds.includes(cardId)) {
      setCardId(firstCard);
    }
  }, [cardId, firstCard, handCardIds]);

  useEffect(() => {
    if (
      scoutCardOne !== normalizedScoutOne ||
      scoutCardTwo !== normalizedScoutTwo ||
      scoutCardThree !== normalizedScoutThree
    ) {
      setScoutCardOne(normalizedScoutOne);
      setScoutCardTwo(normalizedScoutTwo);
      setScoutCardThree(normalizedScoutThree);
    }
  }, [
    normalizedScoutOne,
    normalizedScoutTwo,
    normalizedScoutThree,
    scoutCardOne,
    scoutCardTwo,
    scoutCardThree,
  ]);

  const sellableIndustries = sellableIndustriesForPlayer(game, playerId);
  const merchantSpaces = merchantSpacesWithTiles(game);
  const sellableIndustryIds = sellableIndustries.map((industry) => industry.id).join('|');
  const merchantSpaceKey = merchantSpaces.map((space) => `${space.id}:${space.merchantTileInstanceId ?? ''}`).join('|');
  const buildLocationOptions = buildLocationOptionsForCard(game, playerId, cardId);
  const buildLocationOptionKey = buildLocationOptions.map((location) => location.id).join('|');
  const buildIndustryOptions = locationId
    ? buildIndustryOptionsForLocationAndCard(game, playerId, cardId, locationId)
    : [];
  const buildIndustryOptionKey = buildIndustryOptions.join('|');
  const selectedBuildSpecId = industryType
    ? player?.industryTileStacks?.[industryType]?.availableSpecIdsInOrder[0]
    : undefined;
  const selectedBuildSpec = selectedBuildSpecId ? staticConfig.industryTileSpecs[selectedBuildSpecId] : undefined;
  const buildCoalRequired = selectedBuildSpec?.cost.coal ?? 0;
  const buildIronRequired = selectedBuildSpec?.cost.iron ?? 0;
  const networkFirstLinkOptions = networkLinkOptionsForSelect(game, playerId, [], 0);
  const networkFirstLinkOptionKey = networkFirstLinkOptions.map((line) => line.id).join('|');
  const networkSecondLinkOptions = linkLineId
    ? networkLinkOptionsForSelect(game, playerId, [linkLineId], 1)
    : [];
  const networkSecondLinkOptionKey = networkSecondLinkOptions.map((line) => line.id).join('|');
  const networkLinkLineIds = linkLineId
    ? secondLinkLineId
      ? [linkLineId, secondLinkLineId]
      : [linkLineId]
    : [];
  const networkCoalRequired = game.era === 'rail' ? networkLinkLineIds.length : 0;
  const developIronRequired = developOne ? (developTwo ? 2 : 1) : 0;
  const buildCoalValues = [buildCoalOne, buildCoalTwo];
  const buildIronValues = [buildIronOne, buildIronTwo];
  const networkCoalValues = [networkCoalOne, networkCoalTwo];
  const developIronValues = [developIronOne, developIronTwo];
  const buildCoalSources = buildCoalValues.map(optionalSource);
  const buildIronSources = buildIronValues.map(optionalSource);
  const networkCoalSources = networkCoalValues.map(optionalSource);
  const developIronSources = developIronValues.map(optionalSource);
  const buildCoalSourcesForSubmit = optionalSources(buildCoalValues, buildCoalRequired);
  const buildIronSourcesForSubmit = optionalSources(buildIronValues, buildIronRequired);
  const networkCoalSourcesForSubmit = optionalSources(networkCoalValues, networkCoalRequired);
  const networkBeerSourceForSubmit = doubleRailBeerSourceForSubmit(game, playerId, networkLinkLineIds, networkBeerSource);
  const networkReason = networkActionReason(
    game,
    playerId,
    cardId,
    networkLinkLineIds,
    networkCoalSourcesForSubmit,
    networkBeerSourceForSubmit,
  );
  const networkCanSubmit = !networkReason;
  const developIndustryTypes = developOne ? (developTwo ? [developOne, developTwo] : [developOne]) : [];
  const developIronSourcesForSubmit = optionalSources(developIronValues, developIronRequired);
  const developReason = developActionReason(game, playerId, cardId, developIndustryTypes, developIronSourcesForSubmit);
  const developCanSubmit = !developReason;
  const developOneOptions = player ? developOptionsForSelect(player, [], 0) : [];
  const developOneOptionKey = developOneOptions.join('|');
  const developTwoOptions = developOne && player
    ? developOptionsForSelect(player, [developOne], 1)
    : [];
  const developTwoOptionKey = developTwoOptions.join('|');
  const slots = industryType ? buildSlotOptionsForIndustry(game, locationId, industryType, playerId) : [];
  const selectedBuildSlotId = slots.some((slot) => slot.id === slotId) ? slotId : slots[0]?.id ?? '';
  const boardBuildRegionOptions = useMemo<BoardBuildRegionOption[]>(() => {
    const optionsBySlot = new Map<string, BoardBuildRegionOption>();

    for (const location of buildLocationOptions) {
      const locationIndustryOptions = buildIndustryOptionsForLocationAndCard(game, playerId, cardId, location.id);
      for (const buildableIndustryType of locationIndustryOptions) {
        const buildableSlots = buildSlotOptionsForIndustry(game, location.id, buildableIndustryType, playerId);
        for (const slot of buildableSlots) {
          if (!BOARD_SLOT_REGIONS[slot.id]) {
            continue;
          }
          const current = optionsBySlot.get(slot.id);
          if (current) {
            if (!current.industryTypes.includes(buildableIndustryType)) {
              current.industryTypes.push(buildableIndustryType);
            }
            continue;
          }
          optionsBySlot.set(slot.id, {
            slotId: slot.id,
            locationId: location.id,
            industryTypes: [buildableIndustryType],
          });
        }
      }
    }

    return Array.from(optionsBySlot.values())
      .map((option) => ({
        ...option,
        industryTypes: industryTypeOrder.filter((orderedType) => option.industryTypes.includes(orderedType)),
      }))
      .sort((a, b) => a.locationId.localeCompare(b.locationId) || a.slotId.localeCompare(b.slotId));
  }, [game, playerId, cardId, buildLocationOptionKey]);
  const boardBuildRegionOptionKey = boardBuildRegionOptions
    .map((option) => `${option.slotId}:${option.industryTypes.join(',')}`)
    .join('|');
  const buildCoalOptions = buildCoalValues.map((_, index) => resourceOptionsFromSources(
    game,
    resourceSourcesForBuildSlot(
      game,
      selectedBuildSlotId,
      legalResourceSourcesForSelect(game, 'coal', locationId, buildCoalSources, index),
    ),
    buildCoalValues,
    index,
  ));
  const buildIronOptions = buildIronValues.map((_, index) => resourceOptionsFromSources(
    game,
    resourceSourcesForBuildSlot(
      game,
      selectedBuildSlotId,
      legalResourceSourcesForSelect(game, 'iron', locationId, buildIronSources, index),
    ),
    buildIronValues,
    index,
  ));
  const networkCoalOptions = networkCoalValues.map((_, index) => resourceOptionsFromSources(
    game,
    legalCoalSourcesForNetworkSelect(game, networkLinkLineIds, networkCoalSources, index),
    networkCoalValues,
    index,
  ));
  const developIronOptions = developIronValues.map((_, index) => resourceOptionsFromSources(
    game,
    legalResourceSourcesForSelect(game, 'iron', ironSourceAnchorLocationId, developIronSources, index),
    developIronValues,
    index,
  ));
  const networkBeerOptions = resourceOptionsFromSources(
    game,
    legalBeerSourcesForNetwork(game, playerId, networkLinkLineIds),
    [networkBeerSource],
    0,
  );
  const networkBeerOptionKey = networkBeerOptions.map((option) => option.value).join('|');
  const buildReason = buildActionReason(
    game,
    playerId,
    cardId,
    locationId,
    selectedBuildSlotId,
    industryType,
    buildCoalSourcesForSubmit,
    buildIronSourcesForSubmit,
  );
  const buildCanSubmit = !buildReason;
  const slotIds = slots.map((slot) => slot.id).join('|');
  const saleBeerSelections: SaleBeerSourceSelection[] = sellSteps.map((step) => {
    const industry = game.board.industryInstances[step.industryId];
    return {
      playerId,
      industryInstanceId: step.industryId,
      saleLocationId: industry?.locationId ?? '',
      merchantSpaceId: step.merchantSpaceId,
      selectedSources: [optionalSource(step.beerOne), optionalSource(step.beerTwo)],
    };
  });
  const sellSalesForSubmit: SellStep[] = sellSteps.map((step) => {
    const industry = game.board.industryInstances[step.industryId];
    const spec = industry ? staticConfig.industryTileSpecs[industry.specId] : undefined;
    const beerRequired = spec?.beerRequiredToSell ?? 0;
    return {
      industryInstanceId: step.industryId,
      merchantSpaceId: step.merchantSpaceId,
      beerSources: optionalSources([step.beerOne, step.beerTwo], beerRequired),
    };
  });
  const sellReason = sellActionReason(game, playerId, cardId, sellSalesForSubmit);
  const sellCanSubmit = !sellReason;

  useEffect(() => {
    if (!buildLocationOptions.some((location) => location.id === locationId)) {
      setLocationId(buildLocationOptions[0]?.id ?? '');
      setBuildCoalOne('');
      setBuildCoalTwo('');
      setBuildIronOne('');
      setBuildIronTwo('');
    }
  }, [buildLocationOptionKey, locationId]);

  useEffect(() => {
    if (!industryType || !buildIndustryOptions.includes(industryType)) {
      setIndustryType(buildIndustryOptions[0] ?? '');
    }
  }, [buildIndustryOptionKey, industryType]);

  useEffect(() => {
    if (!slots.some((slot) => slot.id === slotId)) {
      setSlotId(slots[0]?.id ?? '');
    }
  }, [slotId, slotIds]);

  useEffect(() => {
    if (!networkFirstLinkOptions.some((line) => line.id === linkLineId)) {
      setLinkLineId(networkFirstLinkOptions[0]?.id ?? '');
      setSecondLinkLineId('');
      setNetworkCoalOne('');
      setNetworkCoalTwo('');
      setNetworkBeerSource('');
    }
  }, [linkLineId, networkFirstLinkOptionKey]);

  useEffect(() => {
    if (secondLinkLineId && !networkSecondLinkOptions.some((line) => line.id === secondLinkLineId)) {
      setSecondLinkLineId('');
      setNetworkCoalTwo('');
      setNetworkBeerSource('');
    }
  }, [secondLinkLineId, networkSecondLinkOptionKey]);

  useEffect(() => {
    if (networkBeerSource && !networkBeerOptions.some((option) => option.value === networkBeerSource)) {
      setNetworkBeerSource('');
    }
  }, [networkBeerSource, networkBeerOptionKey]);

  useEffect(() => {
    if (!developOneOptions.includes(developOne as IndustryType)) {
      setDevelopOne(developOneOptions[0] ?? '');
      setDevelopTwo('');
    }
  }, [developOne, developOneOptionKey]);

  useEffect(() => {
    if (developTwo && !developTwoOptions.includes(developTwo)) {
      setDevelopTwo('');
    }
  }, [developTwo, developTwoOptionKey]);

  useEffect(() => {
    setSellSteps((current) => {
      return normalizeSellStepDrafts(game, playerId, current);
    });
  }, [game, playerId, merchantSpaceKey, sellableIndustryIds]);

  function submitBuild(event: FormEvent) {
    event.preventDefault();
    if (!buildCanSubmit) {
      return;
    }
    sendCommand({
      type: 'build',
      playerId,
      cardId,
      locationId,
      slotId: selectedBuildSlotId,
      industryType: industryType as IndustryType,
      coalSources: buildCoalSourcesForSubmit,
      ironSources: buildIronSourcesForSubmit,
    });
  }

  function submitNetwork(event: FormEvent) {
    event.preventDefault();
    if (!networkCanSubmit) {
      return;
    }
    sendCommand({
      type: 'network',
      playerId,
      cardId,
      linkLineIds: networkLinkLineIds,
      coalSources: networkCoalSourcesForSubmit,
      beerSourceForDoubleRail: networkBeerSourceForSubmit,
    });
  }

  function submitDevelop(event: FormEvent) {
    event.preventDefault();
    if (!developCanSubmit) {
      return;
    }
    sendCommand({
      type: 'develop',
      playerId,
      cardId,
      industryTypes: developIndustryTypes,
      ironSources: developIronSourcesForSubmit,
    });
  }

  function submitScout(event: FormEvent) {
    event.preventDefault();
    if (scoutCanSubmit) {
      sendCommand({ type: 'scout', playerId, cardIds: scoutCards as [string, string, string] });
    }
  }

  function updateSellStep(index: number, patch: Partial<SellStepDraft>) {
    setSellSteps((current) => current.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step));
  }

  function changeSellStepIndustry(index: number, industryId: string) {
    updateSellStep(index, { industryId, beerOne: '', beerTwo: '' });
  }

  function changeSellStepMerchant(index: number, merchantSpaceId: string) {
    updateSellStep(index, { merchantSpaceId, beerOne: '', beerTwo: '' });
  }

  function addSellStep() {
    setSellSteps((current) => addSellStepDraft(game, playerId, current));
  }

  function removeSellStep(index: number) {
    setSellSteps((current) => current.length <= 1 ? current : current.filter((_, stepIndex) => stepIndex !== index));
  }

  function sellableIndustriesForStep(index: number) {
    return sellableIndustriesForSellStep(sellableIndustries, sellSteps, index);
  }

  function merchantSpacesForIndustry(industryId: string) {
    return merchantSpacesForSellIndustry(game, industryId, merchantSpaces);
  }

  function submitSell(event: FormEvent) {
    event.preventDefault();
    if (!sellCanSubmit) {
      return;
    }
    sendCommand({
      type: 'sell',
      playerId,
      cardId,
      sales: sellSalesForSubmit,
    });
  }

  function merchantSpaceLabel(space: { id: string; merchantTileInstanceId?: string; beerPresent: boolean }) {
    const specId = space.merchantTileInstanceId?.replace(/-\d+$/, '') ?? 'empty';
    const tile = staticConfig.merchantTileSpecs[specId];
    const accepts = tile ? (tile.blank ? 'blank' : tile.acceptedIndustryTypes.join(', ')) : 'unknown';
    return `${abbreviatedId(space.id)}: ${accepts}, beer ${space.beerPresent ? 'yes' : 'no'}`;
  }

  function cardLabel(id: string): string {
    return staticConfig.cardSpecs[id]?.name ?? abbreviatedId(id);
  }

  const passReason = passActionReason(game, playerId, cardId);
  const loanReason = loanActionReason(game, playerId, cardId);
  const scoutReason = scoutActionReason(game, playerId, scoutCards);
  const passCanSubmit = !passReason;
  const loanCanSubmit = !loanReason;
  const scoutCanSubmit = !scoutReason;
  const boardBuildSelectionRequestId = boardBuildSelectionRequest?.requestId ?? 0;
  const actionTabs: Array<{ id: ActionTab; label: string; canSubmit: boolean; reason?: string }> = [
    { id: 'build', label: 'Build', canSubmit: buildCanSubmit, reason: buildReason },
    { id: 'network', label: 'Network', canSubmit: networkCanSubmit, reason: networkReason },
    { id: 'develop', label: 'Develop', canSubmit: developCanSubmit, reason: developReason },
    { id: 'sell', label: 'Sell', canSubmit: sellCanSubmit, reason: sellReason },
    { id: 'loan', label: 'Loan', canSubmit: loanCanSubmit, reason: loanReason },
    { id: 'scout', label: 'Scout', canSubmit: scoutCanSubmit, reason: scoutReason },
    { id: 'pass', label: 'Pass', canSubmit: passCanSubmit, reason: passReason },
  ];
  const selectedActionMeta = actionTabs.find((action) => action.id === selectedAction);

  useEffect(() => {
    return () => {
      onBoardBuildOverlayChange?.(emptyBoardBuildOverlayState);
    };
  }, [onBoardBuildOverlayChange]);

  useEffect(() => {
    onBoardBuildOverlayChange?.({
      active: selectedAction === 'build' && boardBuildRegionOptions.length > 0,
      playerId,
      cardId,
      selectedSlotId: selectedBuildSlotId,
      selectedIndustryType: industryType,
      options: selectedAction === 'build' ? boardBuildRegionOptions : [],
    });
  }, [
    onBoardBuildOverlayChange,
    selectedAction,
    playerId,
    cardId,
    selectedBuildSlotId,
    industryType,
    boardBuildRegionOptionKey,
  ]);

  useEffect(() => {
    const request = boardBuildSelectionRequest;
    if (!request || request.playerId !== playerId) {
      return;
    }
    setSelectedAction('build');
    if (handCardIds.includes(request.cardId)) {
      setCardId(request.cardId);
    }
    setLocationId(request.locationId);
    setSlotId(request.slotId);
    setIndustryType(request.industryType);
    setBuildCoalOne('');
    setBuildCoalTwo('');
    setBuildIronOne('');
    setBuildIronTwo('');
  }, [boardBuildSelectionRequestId, playerId]);

  return (
    <section className="action-panel">
      <div className="section-heading-row">
        <h3>Turn Actions</h3>
        <span className="muted-text">{playerLabelForView(game, playerId)}</span>
      </div>
      <div className="selected-card-panel">
        <CardThumb assets={assets} cardId={cardId} selected />
        <label>
          Action card
          <select value={cardId} onChange={(event) => setCardId(event.target.value)}>
            {handCardIds.length === 0 && <option value="">No hand cards</option>}
            {handCardIds.map((id) => <option key={id} value={id}>{staticConfig.cardSpecs[id]?.name ?? id}</option>)}
          </select>
        </label>
      </div>
      <div className="action-tabs" role="tablist" aria-label="Actions">
        {actionTabs.map((action) => (
          <button
            key={action.id}
            type="button"
            className={selectedAction === action.id ? 'is-active' : ''}
            onClick={() => setSelectedAction(action.id)}
            title={action.reason}
          >
            {action.label}
            <span>{action.canSubmit ? 'ready' : 'blocked'}</span>
          </button>
        ))}
      </div>
      {selectedActionMeta?.reason && <div className="action-reason">{selectedActionMeta.reason}</div>}

      {selectedAction === 'pass' && (
        <form className="action-card" onSubmit={(event) => {
          event.preventDefault();
          if (passCanSubmit) {
            sendCommand({ type: 'pass', playerId, cardId });
          }
        }}>
          <h4>Pass</h4>
          <p className="muted-text">Discard the selected card and take no board action.</p>
          <button type="submit" disabled={!passCanSubmit} title={passReason}>Pass</button>
          <ActionReason reason={passReason} />
        </form>
      )}

      {selectedAction === 'loan' && (
        <form className="action-card" onSubmit={(event) => {
          event.preventDefault();
          if (loanCanSubmit) {
            sendCommand({ type: 'loan', playerId, cardId });
          }
        }}>
          <h4>Loan</h4>
          <p className="muted-text">Take cash, reduce income, and discard the selected card.</p>
          <button type="submit" disabled={!loanCanSubmit} title={loanReason}>Loan</button>
          <ActionReason reason={loanReason} />
        </form>
      )}

      {selectedAction === 'scout' && (
        <form className="action-card" onSubmit={submitScout}>
          <h4>Scout</h4>
          <label>
            Scout card 1
            <select value={scoutCardOne} onChange={(event) => setScoutCardOne(event.target.value)}>
              {!scoutAllowed && <option value="">Scout unavailable</option>}
              {scoutCardOptions[0].map((id) => <option key={id} value={id}>{cardLabel(id)}</option>)}
            </select>
          </label>
          <label>
            Scout card 2
            <select value={scoutCardTwo} onChange={(event) => setScoutCardTwo(event.target.value)}>
              {!scoutAllowed && <option value="">Scout unavailable</option>}
              {scoutCardOptions[1].map((id) => <option key={id} value={id}>{cardLabel(id)}</option>)}
            </select>
          </label>
          <label>
            Scout card 3
            <select value={scoutCardThree} onChange={(event) => setScoutCardThree(event.target.value)}>
              {!scoutAllowed && <option value="">Scout unavailable</option>}
              {scoutCardOptions[2].map((id) => <option key={id} value={id}>{cardLabel(id)}</option>)}
            </select>
          </label>
          <button type="submit" disabled={!scoutCanSubmit} title={scoutReason}>Scout</button>
          <ActionReason reason={scoutReason} />
        </form>
      )}

      {selectedAction === 'build' && (
        <form className="action-card" onSubmit={submitBuild}>
          <h4>Build</h4>
          <label>
            Location
            <select value={locationId} onChange={(event) => {
              setLocationId(event.target.value);
              setBuildCoalOne('');
              setBuildCoalTwo('');
              setBuildIronOne('');
              setBuildIronTwo('');
            }}>
              {buildLocationOptions.length === 0 && <option value="">No valid locations</option>}
              {buildLocationOptions.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </label>
          <label>
            Slot
            <select value={slotId} onChange={(event) => setSlotId(event.target.value)}>
              {slots.length === 0 && <option value="">No valid slots</option>}
              {slots.map((slot) => <option key={slot.id} value={slot.id}>{abbreviatedId(slot.id)}: {slot.allowedIndustryTypes.join(', ')}</option>)}
            </select>
          </label>
          <label>
            Industry
            <select value={industryType} onChange={(event) => setIndustryType(event.target.value as IndustryType | '')}>
              {buildIndustryOptions.length === 0 && <option value="">No buildable industries</option>}
              {buildIndustryOptions.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>
          {buildCoalRequired >= 1 && (
            <ResourceSourceSelect
              label="Coal source 1"
              options={buildCoalOptions[0]}
              value={buildCoalOne}
              onChange={(value) => {
                setBuildCoalOne(value);
                setBuildCoalTwo('');
              }}
            />
          )}
          {buildCoalRequired >= 2 && <ResourceSourceSelect label="Coal source 2" options={buildCoalOptions[1]} value={buildCoalTwo} onChange={setBuildCoalTwo} />}
          {buildIronRequired >= 1 && (
            <ResourceSourceSelect
              label="Iron source 1"
              options={buildIronOptions[0]}
              value={buildIronOne}
              onChange={(value) => {
                setBuildIronOne(value);
                setBuildIronTwo('');
              }}
            />
          )}
          {buildIronRequired >= 2 && <ResourceSourceSelect label="Iron source 2" options={buildIronOptions[1]} value={buildIronTwo} onChange={setBuildIronTwo} />}
          <button type="submit" disabled={!buildCanSubmit} title={buildReason}>Build</button>
          <ActionReason reason={buildReason} />
        </form>
      )}

      {selectedAction === 'network' && (
        <form className="action-card" onSubmit={submitNetwork}>
          <h4>Network</h4>
          <label>
            Link
            <select value={linkLineId} onChange={(event) => {
              setLinkLineId(event.target.value);
              setSecondLinkLineId('');
              setNetworkCoalOne('');
              setNetworkCoalTwo('');
              setNetworkBeerSource('');
            }}>
              {networkFirstLinkOptions.length === 0 && <option value="">No valid links</option>}
              {networkFirstLinkOptions.map((line) => (
                <option key={line.id} value={line.id}>{abbreviatedId(line.id)}</option>
              ))}
            </select>
          </label>
          <label>
            Second link
            <select value={secondLinkLineId} onChange={(event) => setSecondLinkLineId(event.target.value)}>
              <option value="">None</option>
              {networkSecondLinkOptions.map((line) => (
                <option key={line.id} value={line.id}>{abbreviatedId(line.id)}</option>
              ))}
            </select>
          </label>
          {networkCoalRequired >= 1 && (
            <ResourceSourceSelect
              label="Rail coal source 1"
              options={networkCoalOptions[0]}
              value={networkCoalOne}
              onChange={(value) => {
                setNetworkCoalOne(value);
                setNetworkCoalTwo('');
              }}
            />
          )}
          {networkCoalRequired >= 2 && <ResourceSourceSelect label="Rail coal source 2" options={networkCoalOptions[1]} value={networkCoalTwo} onChange={setNetworkCoalTwo} />}
          {game.era === 'rail' && networkLinkLineIds.length === 2 && (
            <ResourceSourceSelect label="Double rail beer source" options={networkBeerOptions} value={networkBeerSource} onChange={setNetworkBeerSource} />
          )}
          <button type="submit" disabled={!networkCanSubmit} title={networkReason}>Network</button>
          <ActionReason reason={networkReason} />
        </form>
      )}

      {selectedAction === 'develop' && (
        <form className="action-card" onSubmit={submitDevelop}>
          <h4>Develop</h4>
          <label>
            First
            <select value={developOne} onChange={(event) => {
              setDevelopOne(event.target.value as IndustryType | '');
              setDevelopTwo('');
            }}>
              {developOneOptions.length === 0 && <option value="">No developable tiles</option>}
              {developOneOptions.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>
          <label>
            Second
            <select value={developTwo} onChange={(event) => setDevelopTwo(event.target.value as IndustryType | '')}>
              <option value="">None</option>
              {developTwoOptions.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>
          {developIronRequired >= 1 && (
            <ResourceSourceSelect
              label="Develop iron source 1"
              options={developIronOptions[0]}
              value={developIronOne}
              onChange={(value) => {
                setDevelopIronOne(value);
                setDevelopIronTwo('');
              }}
            />
          )}
          {developIronRequired >= 2 && <ResourceSourceSelect label="Develop iron source 2" options={developIronOptions[1]} value={developIronTwo} onChange={setDevelopIronTwo} />}
          <button type="submit" disabled={!developCanSubmit} title={developReason}>Develop</button>
          <ActionReason reason={developReason} />
        </form>
      )}

      {selectedAction === 'sell' && (
        <form className="action-card" onSubmit={submitSell}>
          <h4>Sell</h4>
          {sellSteps.map((step, index) => {
            const sellableOptions = sellableIndustriesForStep(index);
            const selectedSellIndustry = step.industryId ? game.board.industryInstances[step.industryId] : undefined;
            const selectedSellSpec = selectedSellIndustry ? staticConfig.industryTileSpecs[selectedSellIndustry.specId] : undefined;
            const sellBeerRequired = selectedSellSpec?.beerRequiredToSell ?? 0;
            const sellBeerValues = [step.beerOne, step.beerTwo];
            const sellBeerOptionsOne = selectedSellIndustry
              ? resourceOptionsFromSources(
                game,
                legalBeerSourcesForSaleSelect(game, saleBeerSelections, index, 0),
                sellBeerValues,
                0,
              )
              : [];
            const sellBeerOptionsTwo = selectedSellIndustry
              ? resourceOptionsFromSources(
                game,
                legalBeerSourcesForSaleSelect(game, saleBeerSelections, index, 1),
                sellBeerValues,
                1,
              )
              : [];
            const merchantOptions = merchantSpacesForIndustry(step.industryId);

            return (
              <div className="sale-step" key={index}>
                <div className="section-heading-row">
                  <h5>Sale {index + 1}</h5>
                  {sellSteps.length > 1 && <button type="button" onClick={() => removeSellStep(index)}>Remove sale</button>}
                </div>
                <label>
                  Industry
                  <select value={step.industryId} onChange={(event) => changeSellStepIndustry(index, event.target.value)}>
                    {sellableOptions.length === 0 && <option value="">No sellable industries</option>}
                    {sellableOptions.map((industry) => (
                      <option key={industry.id} value={industry.id}>{abbreviatedId(industry.id)}: {industry.industryType} at {abbreviatedId(industry.locationId)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Merchant
                  <select value={step.merchantSpaceId} onChange={(event) => changeSellStepMerchant(index, event.target.value)}>
                    {merchantOptions.length === 0 && <option value="">No valid merchants</option>}
                    {merchantOptions.map((space) => (
                      <option key={space.id} value={space.id}>{merchantSpaceLabel(space)}</option>
                    ))}
                  </select>
                </label>
                {sellBeerRequired >= 1 && (
                  <ResourceSourceSelect
                    label={`Sale ${index + 1} beer source 1`}
                    options={sellBeerOptionsOne}
                    value={step.beerOne}
                    onChange={(value) => updateSellStep(index, { beerOne: value })}
                  />
                )}
                {sellBeerRequired >= 2 && (
                  <ResourceSourceSelect
                    label={`Sale ${index + 1} beer source 2`}
                    options={sellBeerOptionsTwo}
                    value={step.beerTwo}
                    onChange={(value) => updateSellStep(index, { beerTwo: value })}
                  />
                )}
              </div>
            );
          })}
          <div className="button-row">
            <button
              type="button"
              onClick={addSellStep}
              disabled={sellSteps.length >= sellableIndustries.length || sellableIndustries.length === 0 || merchantSpaces.length === 0}
            >
              Add sale
            </button>
            <button
              type="submit"
              disabled={!sellCanSubmit}
              title={sellReason}
            >
              Sell
            </button>
          </div>
          <ActionReason reason={sellReason} />
        </form>
      )}
    </section>
  );
}

function eventSummary(game: GameState, event: GameState['eventLog'][number]): string {
  switch (event.type) {
    case 'game_created':
      return `Game created for ${event.playerIds.map((playerId) => playerLabelForView(game, playerId)).join(', ')}`;
    case 'card_discarded':
      return `${playerLabelForView(game, event.playerId)} discarded ${staticConfig.cardSpecs[event.cardId]?.name ?? abbreviatedId(event.cardId)}`;
    case 'cash_changed':
      return `${playerLabelForView(game, event.playerId)} cash ${event.delta > 0 ? '+' : ''}${event.delta} (${event.reason})`;
    case 'income_position_changed':
      return `${playerLabelForView(game, event.playerId)} income position ${event.from} to ${event.to}`;
    case 'industry_built':
      return `${playerLabelForView(game, event.instance.ownerPlayerId)} built ${industryLabel(event.instance.industryType)} at ${abbreviatedId(event.instance.locationId)}`;
    case 'industry_removed':
      return `Industry ${abbreviatedId(event.industryInstanceId)} removed (${event.reason})`;
    case 'industry_flipped':
      return `${playerLabelForView(game, event.ownerPlayerId)} flipped ${abbreviatedId(event.industryInstanceId)}`;
    case 'industry_sold':
      return `${playerLabelForView(game, event.ownerPlayerId)} sold ${abbreviatedId(event.industryInstanceId)} to ${abbreviatedId(event.merchantSpaceId)}`;
    case 'resource_consumed':
      return `${playerLabelForView(game, event.byPlayerId)} consumed ${event.source.kind.replace(/_/g, ' ')} (${event.reason})`;
    case 'resource_sold_to_market':
      return `${abbreviatedId(event.industryInstanceId)} sold ${event.market} for ${event.cashReceived}`;
    case 'link_built':
      return `${playerLabelForView(game, event.instance.ownerPlayerId)} built ${event.instance.linkType} on ${abbreviatedId(event.instance.linkLineId)}`;
    case 'link_scored':
      return `${playerLabelForView(game, event.ownerPlayerId)} scored ${event.points} from ${abbreviatedId(event.linkInstanceId)}`;
    case 'industry_scored':
      return `${playerLabelForView(game, event.ownerPlayerId)} scored ${event.points} from ${abbreviatedId(event.industryInstanceId)}`;
    case 'merchant_bonus_claimed':
      return `${playerLabelForView(game, event.playerId)} claimed merchant bonus at ${abbreviatedId(event.merchantSpaceId)}`;
    case 'merchant_develop_resolved':
      return `${playerLabelForView(game, event.playerId)} resolved merchant develop`;
    case 'turn_advanced':
      return `Turn advanced to ${playerLabelForView(game, event.currentPlayerId)} in round ${event.roundNumber}`;
    case 'turn_order_updated':
      return `Turn order: ${event.order.map((playerId) => playerLabelForView(game, playerId)).join(', ')}`;
    case 'negative_income_started':
      return `${playerLabelForView(game, event.playerId)} must cover ${event.amountOwed}`;
    case 'negative_income_resolved':
      return `${playerLabelForView(game, event.playerId)} resolved negative income`;
    case 'victory_points_changed':
      return `${playerLabelForView(game, event.playerId)} VP ${event.delta > 0 ? '+' : ''}${event.delta}`;
    case 'era_ended':
      return `${event.era} era ended`;
    case 'game_ended':
      return `Game ended. Winner: ${event.winners.map((playerId) => playerLabelForView(game, playerId)).join(', ')}`;
    case 'loan_taken':
      return `${playerLabelForView(game, event.playerId)} took a loan`;
    case 'scouted':
      return `${playerLabelForView(game, event.playerId)} scouted`;
    default:
      return JSON.stringify(event);
  }
}

function EventLog({ game }: { game: GameState }) {
  return (
    <section className="event-log">
      <div className="section-heading-row">
        <h3>Event Log</h3>
        <span className="muted-text">last 20</span>
      </div>
      {game.eventLog.length === 0 ? <div className="empty-state">No events yet.</div> : (
        <ol>
          {game.eventLog.slice(-20).map((event, index) => (
            <li key={index}>
              <span>{eventSummary(game, event)}</span>
              <details>
                <summary>details</summary>
                <pre>{JSON.stringify(event, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

type BrassRootElement = HTMLElement & {
  __brassReactRoot?: Root;
};

const rootElement = document.getElementById('root') as BrassRootElement | null;
if (!rootElement) {
  throw new Error('Root element not found.');
}

const reactRoot = rootElement.__brassReactRoot ?? createRoot(rootElement);
rootElement.__brassReactRoot = reactRoot;
reactRoot.render(<App />);
