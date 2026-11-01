export type MarketKind = 'game' | 'championship' | 'other';

export interface RadarMarket {
  ticker: string;
  eventTicker: string;
  title: string;
  eventTitle: string;
  sport: string;
  seriesTitle: string;
  kind: MarketKind;
  yesBid: number | null;
  yesAsk: number | null;
  noAsk: number | null;
  lastPrice: number | null;
  previousPrice: number | null;
  priceChange: number | null;
  volume24h: number;
  openInterest: number;
  closeTime: string | null;
}

export interface RadarResponse {
  source: 'Kalshi public API';
  scannedAt: string;
  markets: RadarMarket[];
  counts: {
    availableSportsSeries: number;
    scannedSeries: number;
    scannedMarkets: number;
    returnedMarkets: number;
    partialCoverage: boolean;
  };
  notes: string[];
}

export interface RadarHistoryPoint {
  sampledAt: string;
  yesAsk: number | null;
  yesBid: number | null;
  lastPrice: number | null;
  volume24h: number;
}

export interface RadarHistoryResponse {
  ticker: string;
  available: boolean;
  points: RadarHistoryPoint[];
  message?: string;
}

export interface NbaTeamStats {
  id: string;
  name: string;
  abbreviation: string;
  record: string | null;
  lastTen: string | null;
  homeRecord: string | null;
  awayRecord: string | null;
  pointsFor: number | null;
  pointsAgainst: number | null;
  differential: number | null;
  streak: string | null;
}

export interface NbaInjury {
  name: string;
  status: string;
  note: string | null;
  updatedAt: string | null;
}

export interface NbaMeeting {
  date: string;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  winnerId: string | null;
}

export interface NbaEloForecast {
  homeWinProbability: number;
  awayWinProbability: number;
  homeElo: number;
  awayElo: number;
}

export interface NbaEloMetadata {
  name: string;
  trainedThroughSeason: number;
  forecastSeason: number;
  validationSeason: number;
  validationGames: number;
  brier: number;
  baselineBrier: number;
  logLoss: number;
  baselineLogLoss: number;
  baselineHomeProbability: number;
  trainingGames: number;
  currentSeasonGames: number;
  resultsThrough: string | null;
  calibration: Array<{ bucket: string; games: number; predicted: number | null; observed: number | null }>;
  available: boolean;
  message: string;
}

export interface NbaComparison {
  gameId: string;
  startTime: string;
  status: 'scheduled' | 'live' | 'final';
  statusDetail: string;
  home: NbaTeamStats;
  away: NbaTeamStats;
  homeScore: number | null;
  awayScore: number | null;
  injuries: {
    home: NbaInjury[];
    away: NbaInjury[];
    reportedAt: string | null;
    available: boolean;
  };
  headToHead: {
    meetings: NbaMeeting[];
    homeWins: number;
    awayWins: number;
    partial: boolean;
  };
  forecast?: NbaEloForecast | null;
}

export interface NbaComparisonResponse {
  source: 'ESPN public basketball feeds';
  fetchedAt: string;
  season: number;
  window: { startsOn: string; endsBefore: string; timeZone: 'America/Los_Angeles' };
  games: NbaComparison[];
  counts: { eligibleGames: number; returnedGames: number; partialCoverage: boolean };
  warnings: string[];
  notes: string[];
  model?: NbaEloMetadata;
}
