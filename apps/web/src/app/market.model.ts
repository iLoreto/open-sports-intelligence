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
