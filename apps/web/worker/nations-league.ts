/** UEFA Nations League 2026/27 research foundation.
 * Independent of market quotes. Ratings are INPUT DATA, never invented defaults.
 * Source: https://www.uefa.com/uefanationsleague/news/0298-1d6ef1acfaef-b54fcf1da859-1000--2026-27-uefa-nations-league-all-you-need-to-know/
 */
export const GROUPS = {
  A1: ['France','Italy','Belgium','Türkiye'],
  A2: ['Germany','Netherlands','Serbia','Greece'],
  A3: ['Spain','Croatia','England','Czechia'],
  A4: ['Portugal','Denmark','Norway','Wales'],
  B1: ['Scotland','Switzerland','Slovenia','North Macedonia'],
  B2: ['Hungary','Ukraine','Georgia','Northern Ireland'],
  B3: ['Israel','Austria','Republic of Ireland','Kosovo'],
  B4: ['Poland','Bosnia and Herzegovina','Romania','Sweden'],
  C1: ['Albania','Finland','Belarus','San Marino'],
  C2: ['Montenegro','Armenia','Cyprus','Latvia'],
  C3: ['Kazakhstan','Slovakia','Faroe Islands','Moldova'],
  C4: ['Iceland','Bulgaria','Estonia','Luxembourg'],
  D1: ['Gibraltar','Malta','Andorra'],
  D2: ['Lithuania','Azerbaijan','Liechtenstein']
} as const;

export interface NationsFixture {
  id: string;
  kickoff: string; // ISO-8601 with timezone; never infer timezone from local date
  group: keyof typeof GROUPS;
  home: string;
  away: string;
  homeGoals?: number;
  awayGoals?: number;
}
export interface NationsRating { team: string; rating: number; asOf: string; source: string; }
export interface NationsForecast {
  fixtureId: string; home: string; away: string; homeWin: number; draw: number; awayWin: number;
  model: 'experimental-elo-draw-v1'; dataCutoff: string; ratingsSource: string[];
}
const aliases: Record<string,string> = { Turkey: 'Türkiye', 'Czech Republic': 'Czechia' };
export const normalizeNation = (team: string): string => aliases[team.trim()] ?? team.trim();
export const ALL_TEAMS = Object.freeze(Object.values(GROUPS).flat());
export function validateRegistry(): void {
  if (ALL_TEAMS.length !== 54 || new Set(ALL_TEAMS).size !== 54) throw new Error('Expected 54 distinct nations');
  for (const [group, teams] of Object.entries(GROUPS)) {
    if (teams.length !== (group.startsWith('D') ? 3 : 4)) throw new Error('Invalid group size: ' + group);
  }
}
export function validateFixtures(fixtures: NationsFixture[]): void {
  const ids = new Set<string>();
  const pairs = new Set<string>();
  for (const f of fixtures) {
    if (ids.has(f.id)) throw new Error('Duplicate fixture ID: ' + f.id);
    ids.add(f.id);
    if (!Number.isFinite(Date.parse(f.kickoff)) || !/(Z|[+-]\d{2}:\d{2})$/.test(f.kickoff)) throw new Error('Invalid kickoff timezone: ' + f.id);
    const home = normalizeNation(f.home), away = normalizeNation(f.away);
    if (home === away || !GROUPS[f.group]?.some(t => t === home) || !GROUPS[f.group]?.some(t => t === away)) throw new Error('Invalid group fixture: ' + f.id);
    const key = f.group + ':' + home + ':' + away;
    if (pairs.has(key)) throw new Error('Duplicate home-away pairing: ' + key);
    pairs.add(key);
    if ((f.homeGoals === undefined) !== (f.awayGoals === undefined)) throw new Error('Incomplete result: ' + f.id);
    if (f.homeGoals !== undefined && (![f.homeGoals, f.awayGoals].every(v => Number.isInteger(v) && v! >= 0))) throw new Error('Invalid result: ' + f.id);
  }
}
export function forecast(fixture: NationsFixture, ratings: NationsRating[], cutoff: string): NationsForecast | null {
  validateFixtures([fixture]);
  const cutoffMs = Date.parse(cutoff);
  if (!Number.isFinite(cutoffMs) || cutoffMs >= Date.parse(fixture.kickoff)) throw new Error('Cutoff must precede kickoff');
  const find = (team: string) => ratings.filter(r => normalizeNation(r.team) === normalizeNation(team) &&
    Number.isFinite(r.rating) && r.source.trim() && Number.isFinite(Date.parse(r.asOf)) &&
    Date.parse(r.asOf) <= cutoffMs).sort((a,b) => Date.parse(b.asOf)-Date.parse(a.asOf))[0];
  const home = find(fixture.home), away = find(fixture.away);
  if (!home || !away) return null; // Never fabricate missing ratings
  const diff = home.rating - away.rating + 65;
  const conditionalHome = 1 / (1 + 10 ** (-diff / 400));
  const draw = Math.max(.15, Math.min(.31, .31 * Math.exp(-Math.abs(diff)/550)));
  return { fixtureId: fixture.id, home: normalizeNation(fixture.home), away: normalizeNation(fixture.away),
    homeWin: (1-draw)*conditionalHome, draw, awayWin: (1-draw)*(1-conditionalHome),
    model: 'experimental-elo-draw-v1', dataCutoff: cutoff, ratingsSource: [home.source, away.source] };
}
validateRegistry();
