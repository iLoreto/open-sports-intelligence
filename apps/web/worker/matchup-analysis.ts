const SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
const STANDINGS = 'https://site.api.espn.com/apis/v2/sports/';

export const espnTeamSports = {
  nba: 'basketball/nba',
  nfl: 'football/nfl',
  nhl: 'hockey/nhl',
  mlb: 'baseball/mlb',
  wnba: 'basketball/wnba',
  ncaaf: 'football/college-football',
  ncaam: 'basketball/mens-college-basketball',
  ncaav: 'volleyball/womens-college-volleyball'
} as const;

export type EspnTeamSport = keyof typeof espnTeamSports;
export type EspnScore = string | number | { value?: number | string; displayValue?: string };

export function espnScoreValue(score: EspnScore | undefined): number {
  const value = typeof score === 'object' && score !== null ? score.value ?? score.displayValue : score;
  return value === undefined || value === null || String(value).trim() === '' ? NaN : Number(value);
}

type Team = { id?: string; displayName?: string; name?: string };
type Competitor = { team?: Team; score?: EspnScore; homeAway?: string };
type Status = { type?: { completed?: boolean } };
type Competition = { date?: string; status?: Status; competitors?: Competitor[] };
type Game = { id?: string; date?: string; status?: Status; competitions?: Competition[] };
type Injury = { athlete?: { displayName?: string }; status?: string; date?: string; details?: { type?: string }; shortComment?: string };
type InjuryGroup = { team?: Team; id?: string; injuries?: Injury[] };
type Summary = { header?: { season?: { year?: number }; competitions?: Competition[] }; injuries?: InjuryGroup[] };
type StandingEntry = { team?: Team; stats?: { name?: string; value?: number; displayValue?: string; summary?: string }[] };
type StandingGroup = { name?: string; standings?: { entries?: StandingEntry[] }; children?: StandingGroup[] };
type Poll = { name?: string; ranks?: { current?: number; team?: Team }[] };
type PastGame = { id: string; date: string; teams: { id: string; name: string; score: number }[] };

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
  if (!response.ok) throw new Error('ESPN HTTP ' + response.status);
  return response.json() as Promise<T>;
}

function getStanding(group: StandingGroup | null, teamId: string): { rank: number | null; group: string | null; record: string | null } | null {
  if (!group) return null;
  const row = group.standings?.entries?.find(entry => entry.team?.id === teamId);
  if (row) {
    const stats = new Map(row.stats?.map(stat => [stat.name, stat]));
    const seed = stats.get('playoffSeed')?.value;
    const wins = stats.get('wins')?.displayValue;
    const losses = stats.get('losses')?.displayValue;
    const ties = stats.get('ties')?.value ?? stats.get('otLosses')?.value;
    const record = stats.get('overall')?.summary ?? (wins !== undefined && losses !== undefined
      ? wins + '–' + losses + (ties ? '–' + ties : '') : null);
    return { rank: seed && seed > 0 && !/^NCAA Division\b/i.test(group.name ?? '') ? seed : null, group: group.name ?? null, record };
  }
  for (const child of group.children ?? []) {
    const found = getStanding(child, teamId);
    if (found) return found;
  }
  return null;
}

function completedGames(schedule: Game[], before: number): PastGame[] {
  const result = new Map<string, PastGame>();
  for (const event of schedule) {
    const game = event.competitions?.[0];
    const ended = event.status?.type?.completed ?? game?.status?.type?.completed;
    const date = event.date || game?.date;
    if (!ended || !event.id || !date || !(Date.parse(date) < before)) continue;
    const teams = (game?.competitors ?? []).map(({ team, score }) => ({
      id: team?.id || '', name: team?.displayName || team?.name || '', score: espnScoreValue(score)
    }));
    if (teams.length !== 2 || teams.some(team => !team.id || !team.name || !Number.isFinite(team.score))) continue;
    result.set(event.id, { id: event.id, date, teams });
  }
  return [...result.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export async function getMatchupAnalysis(league: EspnTeamSport, eventId: string, signal: AbortSignal) {
  const sport = espnTeamSports[league];
  const summary = await fetchJson<Summary>(SITE + sport + '/summary?event=' + eventId, signal);
  const competition = summary.header?.competitions?.[0];
  const teams = (competition?.competitors ?? []).map(({ team }) => ({
    id: team?.id || '', name: team?.displayName || team?.name || ''
  }));
  if (teams.length !== 2 || teams.some(team => !/^\d+$/.test(team.id) || !team.name) || teams[0].id === teams[1].id) {
    throw new Error('ESPN did not return two teams for this game');
  }

  const season = summary.header?.season?.year;
  const historySeasons = league === 'nfl' || league === 'ncaaf' ? 5 : 2;
  const seasons = season ? Array.from({ length: historySeasons }, (_, index) => String(season - index)) : [''];
  const kickoff = Date.parse(competition?.date ?? '');
  const before = Math.min(Date.now(), Number.isFinite(kickoff) ? kickoff : Date.now());
  const college = league.startsWith('ncaa');
  const [standings, poll, injuryFeed, histories] = await Promise.all([
    fetchJson<StandingGroup>(STANDINGS + sport + '/standings', signal).catch(() => null),
    college ? fetchJson<{ rankings?: Poll[] }>(SITE + sport + '/rankings', signal).catch(() => null) : null,
    Array.isArray(summary.injuries) ? { injuries: summary.injuries } :
      fetchJson<{ injuries?: InjuryGroup[] }>(SITE + sport + '/injuries?limit=1000', signal).catch(() => null),
    Promise.all(teams.map(async team => {
      const results = await Promise.allSettled(seasons.map(async year => {
        const payload = await fetchJson<{ events?: Game[] }>(SITE + sport + '/teams/' + team.id + '/schedule' +
          (year ? '?season=' + year : ''), signal);
        if (!Array.isArray(payload.events)) throw new Error('ESPN schedule unavailable');
        return payload.events;
      }));
      return {
        games: results.flatMap(result => result.status === 'fulfilled' ? result.value : []),
        partial: results.some(result => result.status === 'rejected')
      };
    }))
  ]);
  signal.throwIfAborted();
  const games = completedGames(histories.flatMap(history => history.games), before);
  const ranking = poll?.rankings?.find(p => /AP Top 25|AVCA/i.test(p.name ?? '') && p.ranks?.length) ??
    poll?.rankings?.find(p => p.ranks?.length);
  const teamData = teams.map((team, index) => {
    const ranked = ranking?.ranks?.find(row => row.team?.id === team.id)?.current;
    const standing = getStanding(standings, team.id);
    const group = injuryFeed?.injuries?.find(row => (row.team?.id ?? row.id) === team.id);
    const injuries = Array.isArray(group?.injuries) ? group.injuries
      .filter(injury => injury.athlete?.displayName && !/^(active|available)$/i.test(injury.status ?? ''))
      .map(injury => ({
        player: injury.athlete?.displayName ?? '',
        status: injury.status ?? null,
        detail: injury.details?.type || injury.shortComment || null,
        updatedAt: injury.date ?? null
      })) : null;
    const recent = games.filter(game => game.teams.some(contender => contender.id === team.id))
      .slice(0, 5).map(game => {
        const [first, second] = game.teams;
        const [subject, opponent] = first.id === team.id ? [first, second] : [second, first];
        return { date: game.date, opponent: opponent.name, scored: subject.score, allowed: opponent.score,
          result: subject.score > opponent.score ? 'W' : subject.score < opponent.score ? 'L' : 'T' };
      });
    return { ...team, poll: ranking ? { name: ranking.name || 'ESPN poll', rank: ranked ?? null } : null,
      standing, recent, historyPartial: histories[index].partial, injuries };
  });
  const headToHead = games.filter(game => teams.every(team => game.teams.some(contender => contender.id === team.id)))
    .slice(0, 5).map(game => ({
      date: game.date, scores: teams.map(team => game.teams.find(contender => contender.id === team.id)!.score)
    }));
  return { source: 'ESPN', fetchedAt: new Date().toISOString(), teams: teamData, headToHead,
    historyPartial: histories.some(history => history.partial) };
}
