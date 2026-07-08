import React, {FormEvent, useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {io, Socket} from 'socket.io-client';
import {
  canSellToMerchant,
  canSellToMerchantSpace,
  legalBeerSourcesForNetwork,
  legalBeerSourcesForSaleSelect,
  legalCoalSourcesForNetworkSelect,
  legalResourceSourcesForSelect,
  type SaleBeerSourceSelection,
} from '../common/gameEngine';
import {getIncomeLevel} from '../common/income';
import {getActiveIndustries, getActiveLinks, getCurrentPlayerId} from '../common/selectors';
import {staticConfig} from '../common/staticData';
import type {GameCommand, GameState, IndustryInstance, IndustryType, SellStep} from '../common/types';
import {canScout, scoutCardOptionsForSelect} from './actionOptions';
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
import {developOptionsForSelect, normalizeDevelopSelections} from './developOptions';
import {doubleRailBeerSourceForSubmit, networkLinkOptionsForSelect} from './networkOptions';
import {
  normalizeResourceSelection,
  optionalSource,
  optionalSources,
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
import {gameSummariesFromPayload, listedGames, type GameSummary, type ListedGame} from './roomListOptions';
import {hashForGameState, parseGameJoinHash, playerSessionHash, playerSessionUrl} from './sessionLinks';
import {canSubmitForActivePlayerView, handPlayerIdForView, sessionForPlayer, sessionNeededForActivePlayerView} from './sessionOptions';
import './styles.css';

type SocketReply = {
  ok: boolean;
  game?: GameState;
  session?: PlayerSession;
  sessions?: PlayerSession[];
  errors?: string[];
};

type PlayerSession = {
  playerId: string;
  token: string;
};

type StoredSessions = Record<string, Record<string, string>>;

type SellStepDraft = {
  industryId: string;
  merchantSpaceId: string;
  beerOne: string;
  beerTwo: string;
};

const serverUrl = import.meta.env.DEV ? 'http://127.0.0.1:3001' : window.location.origin;
const sessionStorageKey = 'brass.playerSessions.v1';
const ironSourceAnchorLocationId = 'birmingham';

function isHiddenCardId(cardId: string): boolean {
  return cardId.startsWith('hidden-card-');
}

function createSellStepDraft(): SellStepDraft {
  return {industryId: '', merchantSpaceId: '', beerOne: '', beerTwo: ''};
}

function readStoredSessions(): StoredSessions {
  try {
    const raw = window.localStorage.getItem(sessionStorageKey);
    return raw ? JSON.parse(raw) as StoredSessions : {};
  } catch {
    return {};
  }
}

function writeStoredSessions(sessions: StoredSessions): void {
  window.localStorage.setItem(sessionStorageKey, JSON.stringify(sessions));
}

function sessionsForGame(gameId: string): PlayerSession[] {
  return Object.entries(readStoredSessions()[gameId] ?? {}).map(([playerId, token]) => ({playerId, token}));
}

function rememberSessions(gameId: string, sessions: PlayerSession[]): PlayerSession[] {
  const stored = readStoredSessions();
  const current = stored[gameId] ?? {};
  for (const session of sessions) {
    current[session.playerId] = session.token;
  }
  stored[gameId] = current;
  writeStoredSessions(stored);
  return Object.entries(current).map(([playerId, token]) => ({playerId, token}));
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
  const socket = useMemo<Socket>(() => io(serverUrl, {autoConnect: true}), []);
  const [game, setGame] = useState<GameState | undefined>();
  const [errors, setErrors] = useState<string[]>([]);
  const [knownSessions, setKnownSessions] = useState<PlayerSession[]>([]);
  const [autoFollowActivePlayer, setAutoFollowActivePlayer] = useState(true);
  const [viewerPlayerId, setViewerPlayerId] = useState<string | undefined>();

  useEffect(() => {
    socket.on('game:state', (nextGame: GameState) => {
      setGame(nextGame);
      window.location.hash = hashForGameState(nextGame.id, window.location.hash);
      setKnownSessions(sessionsForGame(nextGame.id));
    });
    const hashJoin = parseGameJoinHash(window.location.hash);
    if (hashJoin) {
      const hashSession = hashJoin.playerId && hashJoin.sessionToken
        ? {playerId: hashJoin.playerId, token: hashJoin.sessionToken}
        : undefined;
      const storedSessions = hashSession
        ? rememberSessions(hashJoin.gameId, [hashSession])
        : sessionsForGame(hashJoin.gameId);
      setKnownSessions(storedSessions);
      const firstSession = hashSession ?? storedSessions[0];
      socket.emit('game:join', firstSession
        ? {gameId: hashJoin.gameId, playerId: firstSession.playerId, sessionToken: firstSession.token}
        : {gameId: hashJoin.gameId}, handleReply);
    }
    return () => {
      socket.off('game:state');
    };
  }, [socket]);

  function handleReply(reply: SocketReply) {
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
      const replyViewerPlayerId = reply.session?.playerId ?? reply.sessions?.[0]?.playerId;
      if (replyViewerPlayerId) {
        setViewerPlayerId(replyViewerPlayerId);
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
    const session = sessionNeededForActivePlayerView(game, knownSessions, {autoFollowActivePlayer});
    if (!session) {
      return;
    }
    setViewerPlayerId(session.playerId);
    socket.emit('game:join', {gameId: game.id, playerId: session.playerId, sessionToken: session.token}, handleReply);
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
    setAutoFollowActivePlayer(true);
    setViewerPlayerId(command.playerId);
    socket.emit('game:command', {gameId: game.id, command, sessionToken: session.token}, handleReply);
  }

  function joinSession(session: PlayerSession) {
    if (!game) {
      return;
    }
    const activePlayerId = game.pendingDecision?.playerId ?? getCurrentPlayerId(game);
    setAutoFollowActivePlayer(session.playerId === activePlayerId);
    setViewerPlayerId(session.playerId);
    window.location.hash = playerSessionHash(game.id, session);
    socket.emit('game:join', {gameId: game.id, playerId: session.playerId, sessionToken: session.token}, handleReply);
  }

  function selectManualViewer(playerId?: string) {
    setAutoFollowActivePlayer(false);
    setViewerPlayerId(playerId);
  }

  return (
    <main>
      <h1>Brass: Birmingham Online</h1>
      <ConnectionPanel socket={socket} onReply={handleReply} onManualJoin={selectManualViewer} />
      {errors.length > 0 && (
        <div>
          <h2>Errors</h2>
          {errors.map((error) => <div key={error}>{error}</div>)}
        </div>
      )}
      {game
        ? (
            <GameView
              game={game}
              knownSessions={knownSessions}
              viewerPlayerId={viewerPlayerId}
              sendCommand={sendCommand}
              joinSession={joinSession}
            />
          )
        : <div>No game loaded.</div>}
    </main>
  );
}

function ConnectionPanel({
  socket,
  onReply,
  onManualJoin,
}: {
  socket: Socket;
  onReply: (reply: SocketReply) => void;
  onManualJoin: (playerId?: string) => void;
}) {
  const [playerCount, setPlayerCount] = useState(2);
  const [playerNames, setPlayerNames] = useState(['Alice', 'Bob']);
  const [joinGameId, setJoinGameId] = useState('');
  const [joinPlayerId, setJoinPlayerId] = useState('');
  const [joinSessionToken, setJoinSessionToken] = useState('');
  const [gameSummaries, setGameSummaries] = useState<GameSummary[]>([]);
  const [gameListError, setGameListError] = useState<string | undefined>();
  const [gameListLoading, setGameListLoading] = useState(false);
  const roomList = listedGames(gameSummaries, sessionsForGame);

  async function loadGames() {
    setGameListLoading(true);
    setGameListError(undefined);
    try {
      const response = await fetch(`${serverUrl}/api/games`);
      const payload = await response.json() as unknown;
      if (!response.ok) {
        setGameListError('Could not load games');
        return;
      }
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

  function updatePlayerCount(nextCount: number) {
    setPlayerCount(nextCount);
    setPlayerNames((names) => Array.from({length: nextCount}, (_, index) => names[index] ?? `Player ${index + 1}`));
  }

  function create(event: FormEvent) {
    event.preventDefault();
    socket.emit('game:create', {playerNames}, (reply: SocketReply) => {
      onReply(reply);
      void loadGames();
    });
  }

  function join(event: FormEvent) {
    event.preventDefault();
    const playerId = joinPlayerId.trim() || undefined;
    const sessionToken = joinSessionToken.trim() || undefined;
    onManualJoin(playerId);
    socket.emit('game:join', {
      gameId: joinGameId.trim(),
      playerId,
      sessionToken,
    }, onReply);
  }

  function observeGame(gameId: string) {
    setJoinGameId(gameId);
    setJoinPlayerId('');
    setJoinSessionToken('');
    onManualJoin(undefined);
    socket.emit('game:join', {gameId}, onReply);
  }

  function joinSavedGameSession(gameId: string, session: PlayerSession) {
    setJoinGameId(gameId);
    setJoinPlayerId(session.playerId);
    setJoinSessionToken(session.token);
    onManualJoin(session.playerId);
    socket.emit('game:join', {gameId, playerId: session.playerId, sessionToken: session.token}, onReply);
  }

  return (
    <section>
      <h2>Room</h2>
      <form onSubmit={create}>
        <label>
          Players
          <select value={playerCount} onChange={(event) => updatePlayerCount(Number(event.target.value))}>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
        {playerNames.map((name, index) => (
          <label key={index}>
            Player {index + 1}
            <input
              value={name}
              onChange={(event) => setPlayerNames((names) => names.map((current, nameIndex) => nameIndex === index ? event.target.value : current))}
            />
          </label>
        ))}
        <button type="submit">Create Game</button>
      </form>
      <form onSubmit={join}>
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
    <section>
      <h3>Existing Games</h3>
      <button type="button" onClick={onRefresh} disabled={loading}>{loading ? 'Loading games' : 'Refresh games'}</button>
      {error && <div>{error}</div>}
      {games.length === 0 ? <div>No games listed.</div> : games.map((game) => (
        <div key={game.id}>
          <div>{game.label}</div>
          <button type="button" onClick={() => onObserve(game.id)}>Observe {game.id}</button>
          {game.savedSessions.map((session) => (
            <button key={session.playerId} type="button" onClick={() => onJoinSession(game.id, session)}>
              Join {game.id} as {session.playerId}
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}

function GameView({
  game,
  knownSessions,
  viewerPlayerId,
  sendCommand,
  joinSession,
}: {
  game: GameState;
  knownSessions: PlayerSession[];
  viewerPlayerId?: string;
  sendCommand: (command: GameCommand) => void;
  joinSession: (session: PlayerSession) => void;
}) {
  const activePlayerId = game.pendingDecision?.playerId ?? getCurrentPlayerId(game);
  const activePlayer = game.players[activePlayerId];
  const handPlayerId = handPlayerIdForView(game, viewerPlayerId);
  const handPlayer = game.players[handPlayerId];
  const canSubmitForActivePlayer = canSubmitForActivePlayerView(game, knownSessions);
  const gameEnded = game.status === 'ended';

  return (
    <section>
      <h2>Game {game.id}</h2>
      <div>Status: {game.status}</div>
      <div>Era: {game.era}</div>
      <div>Round: {game.roundNumber}</div>
      {!gameEnded && (
        <>
          <div>{game.pendingDecision ? 'Pending player' : 'Current player'}: {activePlayer.name} ({activePlayer.id})</div>
          <div>Viewing player: {handPlayer.name} ({handPlayer.id})</div>
          <div>Action {game.actionIndexInTurn + 1} / {game.actionsAllowedThisTurn}</div>
        </>
      )}
      <PlayersTable game={game} />
      <SessionSummary game={game} knownSessions={knownSessions} viewerPlayerId={handPlayerId} joinSession={joinSession} />
      <BoardSummary game={game} />
      <LastEraScore game={game} />
      {gameEnded ? (
        <GameOverSummary game={game} />
      ) : (
        <>
          <HandPanel game={game} playerId={handPlayerId} />
          {canSubmitForActivePlayer
            ? (game.pendingDecision
                ? <PendingDecisionPanel game={game} sendCommand={sendCommand} />
                : <ActionForms game={game} playerId={activePlayerId} sendCommand={sendCommand} />)
            : <div>Join with the saved session for {activePlayerId} to submit actions.</div>}
        </>
      )}
      <EventLog game={game} />
    </section>
  );
}

function GameOverSummary({game}: {game: GameState}) {
  const gameEndedEvent = [...game.eventLog].reverse().find((event) => event.type === 'game_ended');
  const winners = gameEndedEvent?.type === 'game_ended' ? gameEndedEvent.winners : [];

  return (
    <section>
      <h3>Game Over</h3>
      <div>
        Winner{winners.length === 1 ? '' : 's'}: {winners.length > 0
          ? winners.map((playerId) => `${game.players[playerId]?.name ?? playerId} (${playerId})`).join(', ')
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
              const player = game.players[playerId];
              return (
                <tr key={playerId}>
                  <td>{player.name} ({playerId})</td>
                  <td>{player.victoryPoints}</td>
                  <td>{player.incomeTrackPosition}</td>
                  <td>{player.cash}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LastEraScore({game}: {game: GameState}) {
  const score = game.lastEraScore;
  return (
    <section>
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
                  <td>{game.players[playerId].name} ({playerId})</td>
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
  const sessionByPlayer = new Map(knownSessions.map((session) => [session.playerId, session]));
  const baseUrl = window.location.href;
  return (
    <section>
      <h3>Saved Sessions</h3>
      {game.turnOrder.map((playerId) => {
        const session = sessionByPlayer.get(playerId);
        return (
          <div key={playerId}>
            {playerId}: {session ? session.token : 'no token saved'}
            {viewerPlayerId === playerId && ' (viewing)'}
            {session && (
              <button type="button" onClick={() => joinSession(session)}>
                Use {playerId} session
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
    </section>
  );
}

function PlayersTable({game}: {game: GameState}) {
  return (
    <section>
      <h3>Players</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Cash</th>
              <th>Income</th>
              <th>VP</th>
              <th>Hand</th>
              <th>Spent</th>
            </tr>
          </thead>
          <tbody>
            {game.turnOrder.map((playerId) => {
              const player = game.players[playerId];
              return (
                <tr key={player.id}>
                  <td>{player.id}</td>
                  <td>{player.name}</td>
                  <td>{player.cash}</td>
                  <td>{getIncomeLevel(player.incomeTrackPosition)}</td>
                  <td>{player.victoryPoints}</td>
                  <td>{player.handCardIds.length}</td>
                  <td>{player.spentThisRound}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BoardSummary({game}: {game: GameState}) {
  const industries = getActiveIndustries(game);
  const links = getActiveLinks(game);
  return (
    <section>
      <h3>Board</h3>
      <div>Coal market cubes: {game.markets.coal.occupiedCount}</div>
      <div>Iron market cubes: {game.markets.iron.occupiedCount}</div>
      <h4>Industries</h4>
      {industries.length === 0 ? <div>No industries built.</div> : industries.map((industry) => (
        <div key={industry.id}>
          {industry.id}: {industry.ownerPlayerId} {industry.industryType} L{industry.level} at {industry.locationId}, resource {industry.remainingResource}, flipped {String(industry.flipped)}
        </div>
      ))}
      <h4>Links</h4>
      {links.length === 0 ? <div>No links built.</div> : links.map((link) => (
        <div key={link.id}>{link.id}: {link.ownerPlayerId} {link.linkType} on {link.linkLineId}</div>
      ))}
    </section>
  );
}

function HandPanel({game, playerId}: {game: GameState; playerId: string}) {
  return (
    <section>
      <h3>{game.players[playerId].name} Hand</h3>
      {game.players[playerId].handCardIds.map((cardId) => {
        if (isHiddenCardId(cardId)) {
          return <div key={cardId}>{cardId}: hidden card</div>;
        }
        const card = staticConfig.cardSpecs[cardId];
        return <div key={cardId}>{cardId}: {card?.name ?? 'Unknown card'}</div>;
      })}
    </section>
  );
}

function PendingDecisionPanel({game, sendCommand}: {game: GameState; sendCommand: (command: GameCommand) => void}) {
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
                  const specId = player.industryTileStacks[industryType].availableSpecIdsInOrder[offset];
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
              {industry.id}: {industry.industryType} L{industry.level} at {industry.locationId}, value {industryLiquidationValue(industry)}
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

function ActionReason({reason}: {reason?: string}) {
  return reason ? <div>{reason}</div> : null;
}

function ActionForms({game, playerId, sendCommand}: {game: GameState; playerId: string; sendCommand: (command: GameCommand) => void}) {
  const handCardIds = game.players[playerId].handCardIds;
  const handCardKey = handCardIds.join('|');
  const firstCard = handCardIds[0] ?? '';
  const [cardId, setCardId] = useState(firstCard);
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
  const scoutOptionKey = scoutCardOptions.map((options) => options.join('|')).join('||');

  useEffect(() => {
    if (!handCardIds.includes(cardId)) {
      setCardId(firstCard);
    }
  }, [cardId, firstCard, handCardIds]);

  useEffect(() => {
    const selected = [scoutCardOne, scoutCardTwo, scoutCardThree];
    const invalidSelection =
      !scoutAllowed ||
      selected.some((id) => !handCardIds.includes(id)) ||
      new Set(selected).size !== selected.length;
    if (invalidSelection) {
      const scoutOptions = scoutAllowed ? handCardIds : [];
      setScoutCardOne(scoutOptions[0] ?? '');
      setScoutCardTwo(scoutOptions[1] ?? '');
      setScoutCardThree(scoutOptions[2] ?? '');
    }
  }, [handCardKey, handCardIds, scoutAllowed, scoutOptionKey, scoutCardOne, scoutCardTwo, scoutCardThree]);

  const sellableIndustries = getActiveIndustries(game)
    .filter((industry) =>
      industry.ownerPlayerId === playerId &&
      !industry.flipped &&
      (industry.industryType === 'cotton_mill' || industry.industryType === 'manufacturer' || industry.industryType === 'pottery') &&
      canSellToMerchant(game, industry),
    );
  const merchantSpaces = Object.values(game.board.merchantSpaces)
    .filter((space) => Boolean(space.merchantTileInstanceId));
  const sellableIndustryIds = sellableIndustries.map((industry) => industry.id).join('|');
  const merchantSpaceIds = merchantSpaces.map((space) => space.id).join('|');
  const buildLocationOptions = buildLocationOptionsForCard(game, playerId, cardId);
  const buildLocationOptionKey = buildLocationOptions.map((location) => location.id).join('|');
  const buildIndustryOptions = locationId
    ? buildIndustryOptionsForLocationAndCard(game, playerId, cardId, locationId)
    : [];
  const buildIndustryOptionKey = buildIndustryOptions.join('|');
  const selectedBuildSpecId = industryType
    ? game.players[playerId].industryTileStacks[industryType].availableSpecIdsInOrder[0]
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
  const networkBeerSourceForSubmit = doubleRailBeerSourceForSubmit(game, networkLinkLineIds, networkBeerSource);
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
  const developOneOptions = developOptionsForSelect(game.players[playerId], [], 0);
  const developOneOptionKey = developOneOptions.join('|');
  const developTwoOptions = developOne
    ? developOptionsForSelect(game.players[playerId], [developOne], 1)
    : [];
  const developTwoOptionKey = developTwoOptions.join('|');
  const buildCoalOptions = buildCoalValues.map((_, index) => resourceOptionsFromSources(
    game,
    legalResourceSourcesForSelect(game, 'coal', locationId, buildCoalSources, index),
    buildCoalValues,
    index,
  ));
  const buildIronOptions = buildIronValues.map((_, index) => resourceOptionsFromSources(
    game,
    legalResourceSourcesForSelect(game, 'iron', locationId, buildIronSources, index),
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
  const slots = industryType ? buildSlotOptionsForIndustry(game, locationId, industryType, playerId) : [];
  const selectedBuildSlotId = slots.some((slot) => slot.id === slotId) ? slotId : slots[0]?.id ?? '';
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
      const desiredLength = Math.min(Math.max(current.length, 1), Math.max(sellableIndustries.length, 1));
      const next = current.slice(0, desiredLength);
      while (next.length < desiredLength) {
        next.push(createSellStepDraft());
      }

      const usedIndustryIds = new Set<string>();
      let changed = next.length !== current.length;
      const normalized = next.map((step) => {
        let industryId = step.industryId;
        if (!sellableIndustries.some((industry) => industry.id === industryId) || usedIndustryIds.has(industryId)) {
          industryId = sellableIndustries.find((industry) => !usedIndustryIds.has(industry.id))?.id ?? '';
        }
        if (industryId) {
          usedIndustryIds.add(industryId);
        }
        const validMerchantSpaces = merchantSpacesForIndustry(industryId);
        const merchantSpaceId = validMerchantSpaces.some((space) => space.id === step.merchantSpaceId)
          ? step.merchantSpaceId
          : validMerchantSpaces[0]?.id ?? '';
        const normalizedStep = {...step, industryId, merchantSpaceId};
        changed = changed ||
          normalizedStep.industryId !== step.industryId ||
          normalizedStep.merchantSpaceId !== step.merchantSpaceId;
        return normalizedStep;
      });
      return changed ? normalized : current;
    });
  }, [merchantSpaceIds, sellableIndustryIds]);

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
      sendCommand({type: 'scout', playerId, cardIds: scoutCards as [string, string, string]});
    }
  }

  function updateSellStep(index: number, patch: Partial<SellStepDraft>) {
    setSellSteps((current) => current.map((step, stepIndex) => stepIndex === index ? {...step, ...patch} : step));
  }

  function changeSellStepIndustry(index: number, industryId: string) {
    updateSellStep(index, {industryId, beerOne: '', beerTwo: ''});
  }

  function changeSellStepMerchant(index: number, merchantSpaceId: string) {
    updateSellStep(index, {merchantSpaceId, beerOne: '', beerTwo: ''});
  }

  function addSellStep() {
    setSellSteps((current) => {
      const selectedIndustryIds = new Set(current.map((step) => step.industryId).filter(Boolean));
      const industryId = sellableIndustries.find((industry) => !selectedIndustryIds.has(industry.id))?.id ?? '';
      if (!industryId) {
        return current;
      }
      return [...current, {
        ...createSellStepDraft(),
        industryId,
        merchantSpaceId: merchantSpacesForIndustry(industryId)[0]?.id ?? '',
      }];
    });
  }

  function removeSellStep(index: number) {
    setSellSteps((current) => current.length <= 1 ? current : current.filter((_, stepIndex) => stepIndex !== index));
  }

  function sellableIndustriesForStep(index: number): IndustryInstance[] {
    const currentIndustryId = sellSteps[index]?.industryId;
    const selectedElsewhere = new Set(sellSteps
      .filter((_, stepIndex) => stepIndex !== index)
      .map((step) => step.industryId)
      .filter(Boolean));
    return sellableIndustries.filter((industry) => industry.id === currentIndustryId || !selectedElsewhere.has(industry.id));
  }

  function merchantSpacesForIndustry(industryId: string) {
    const industry = game.board.industryInstances[industryId];
    return industry ? merchantSpaces.filter((space) => canSellToMerchantSpace(game, industry, space.id)) : [];
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

  function merchantSpaceLabel(space: {id: string; merchantTileInstanceId?: string; beerPresent: boolean}) {
    const specId = space.merchantTileInstanceId?.replace(/-\d+$/, '') ?? 'empty';
    const tile = staticConfig.merchantTileSpecs[specId];
    const accepts = tile ? (tile.blank ? 'blank' : tile.acceptedIndustryTypes.join(', ')) : 'unknown';
    return `${space.id}: ${accepts}, beer ${space.beerPresent ? 'yes' : 'no'}`;
  }

  function cardLabel(id: string): string {
    return staticConfig.cardSpecs[id]?.name ?? id;
  }

  const passReason = passActionReason(game, playerId, cardId);
  const loanReason = loanActionReason(game, playerId, cardId);
  const scoutReason = scoutActionReason(game, playerId, scoutCards);
  const passCanSubmit = !passReason;
  const loanCanSubmit = !loanReason;
  const scoutCanSubmit = !scoutReason;

  return (
    <section>
      <h3>Actions</h3>
      <label>
        Action card
        <select value={cardId} onChange={(event) => setCardId(event.target.value)}>
          {game.players[playerId].handCardIds.map((id) => <option key={id} value={id}>{staticConfig.cardSpecs[id]?.name ?? id}</option>)}
        </select>
      </label>

      <form onSubmit={(event) => {
        event.preventDefault();
        if (passCanSubmit) {
          sendCommand({type: 'pass', playerId, cardId});
        }
      }}>
        <button type="submit" disabled={!passCanSubmit} title={passReason}>Pass</button>
        <ActionReason reason={passReason} />
      </form>

      <form onSubmit={(event) => {
        event.preventDefault();
        if (loanCanSubmit) {
          sendCommand({type: 'loan', playerId, cardId});
        }
      }}>
        <button type="submit" disabled={!loanCanSubmit} title={loanReason}>Loan</button>
        <ActionReason reason={loanReason} />
      </form>

      <form onSubmit={submitScout}>
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

      <form onSubmit={submitBuild}>
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
            {slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.id}: {slot.allowedIndustryTypes.join(', ')}</option>)}
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

      <form onSubmit={submitNetwork}>
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
              <option key={line.id} value={line.id}>{line.id}</option>
            ))}
          </select>
        </label>
        <label>
          Second link
          <select value={secondLinkLineId} onChange={(event) => setSecondLinkLineId(event.target.value)}>
            <option value="">None</option>
            {networkSecondLinkOptions.map((line) => (
              <option key={line.id} value={line.id}>{line.id}</option>
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

      <form onSubmit={submitDevelop}>
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

      <form onSubmit={submitSell}>
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
            <div key={index}>
              <h5>Sale {index + 1}</h5>
              {sellSteps.length > 1 && <button type="button" onClick={() => removeSellStep(index)}>Remove sale</button>}
            <label>
              Industry
              <select value={step.industryId} onChange={(event) => changeSellStepIndustry(index, event.target.value)}>
                {sellableOptions.length === 0 && <option value="">No sellable industries</option>}
                {sellableOptions.map((industry) => (
                  <option key={industry.id} value={industry.id}>{industry.id}: {industry.industryType} at {industry.locationId}</option>
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
                  onChange={(value) => updateSellStep(index, {beerOne: value})}
                />
              )}
              {sellBeerRequired >= 2 && (
                <ResourceSourceSelect
                  label={`Sale ${index + 1} beer source 2`}
                  options={sellBeerOptionsTwo}
                  value={step.beerTwo}
                  onChange={(value) => updateSellStep(index, {beerTwo: value})}
                />
              )}
            </div>
          );
        })}
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
        <ActionReason reason={sellReason} />
      </form>
    </section>
  );
}

function EventLog({game}: {game: GameState}) {
  return (
    <section>
      <h3>Event Log</h3>
      {game.eventLog.slice(-20).map((event, index) => (
        <pre key={index}>{JSON.stringify(event)}</pre>
      ))}
    </section>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
