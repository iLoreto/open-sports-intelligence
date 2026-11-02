import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import type { NbaComparison, NbaComparisonResponse, RadarHistoryResponse, RadarMarket, RadarResponse, SportsCatalogResponse } from './market.model';

const REFRESH_MS = 30 * 60 * 1000;

@Component({
  selector: 'osi-root',
  standalone: true,
  imports: [CommonModule],
  template: `
  <div class="app-shell">
    <div class="ambient ambient-left"></div>
    <div class="ambient ambient-right"></div>

    <header class="masthead container">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"><span class="mark-bar one"></span><span class="mark-bar two"></span><span class="mark-bar three"></span><span class="mark-dot"></span></div>
        <div class="brand-text"><strong>OPEN SPORTS</strong><span>INTELLIGENCE</span></div>
      </div>
      <div class="header-right">
        <span class="live-label"><span class="live-dot"></span> PUBLIC MARKET DATA</span>
        <a class="github-link" href="https://github.com/iLoreto/open-sports-intelligence" target="_blank" rel="noopener noreferrer">GITHUB <span aria-hidden="true">↗</span></a>
      </div>
    </header>

    <main class="container">
      <section class="hero">
        <div class="eyebrow"><span class="eyebrow-line"></span> THE INTELLIGENCE TERMINAL <span class="version-tag">V0.4 / FULL BOOK</span></div>
        <h1>See the market.<br><span>Question the price.</span></h1>
        <p class="hero-copy">Explore public Sports contracts at every quoted price, and compare NBA teams using recorded results and an experimental, historically tested Elo baseline. Market prices and model estimates stay separate.</p>
        <div class="hero-actions">
          <span class="source-state"><span class="source-pulse"></span> {{ loading() ? 'SCANNING PUBLIC FEED' : error() ? 'FEED UNAVAILABLE' : 'KALSHI FEED CONNECTED' }}</span>
          <button class="refresh-button" type="button" (click)="refresh(true)" [disabled]="loading() || nbaLoading()" [attr.aria-busy]="loading() || nbaLoading()">
            <span aria-hidden="true" class="refresh-icon" [class.spinning]="loading()">↻</span>
            {{ loading() || nbaLoading() ? 'SCANNING' : 'REFRESH DATA' }}
          </button>
        </div>
      </section>

      <section class="radar-panel nba-panel" aria-label="NBA matchup comparisons">
        <div class="panel-heading">
          <div>
            <div class="section-kicker">NBA / MATCHUP RESEARCH</div>
            <h2>Side-by-side comparisons <span class="heading-count">{{ nba()?.games?.length ?? '—' }}</span></h2>
            <p>Season form, recent meetings, reported injuries and experimental pregame Elo estimates.</p>
          </div>
          <div class="nba-panel-actions"><a class="catalog-nba-shortcut" href="#sports-catalog" (click)="selectCatalogSport('NBA')">VIEW NBA MARKETS ↗</a><span class="panel-pill nba-pill">2026–27 SEASON</span></div>
        </div>
        <p *ngIf="nbaLoading() && !nba()" class="nba-state">Loading NBA schedules, standings and injury reports…</p>
        <div *ngIf="nbaError()" class="nba-warning" role="alert">NBA feed: {{ nbaError() }}<span *ngIf="nba()"> Previously loaded comparisons are shown below; check the update time.</span></div>
        <ng-container *ngIf="nba() as data">
          <div class="nba-feed-meta">ESPN public basketball feeds · Last fetched {{ dateTime(data.fetchedAt) }} · {{ data.season - 1 }}–{{ data.season.toString().slice(-2) }} season</div>
          <div *ngFor="let warning of data.warnings" class="nba-warning">{{ warning }}</div>
          <ng-container *ngIf="data.model as model">
            <div class="nba-model-overview">
              <div class="nba-model-copy"><strong>{{ model.name }} <span>EXPERIMENTAL</span></strong><p>Out-of-sample evaluation on {{ model.validationGames }} games in {{ model.validationSeason - 1 }}–{{ model.validationSeason.toString().slice(-2) }}. Lower Brier score means more accurate probabilities. No lineups, injuries or sportsbook information enter this model.</p></div>
              <div class="nba-model-metrics">
                <div><span>ELO BRIER</span><strong>{{ model.brier.toFixed(3) }}</strong></div>
                <div><span>HOME-ONLY BASELINE</span><strong>{{ model.baselineBrier.toFixed(3) }}</strong></div>
              </div>
            </div>
            <div class="nba-model-status">{{ model.message }} <span *ngIf="model.available">· {{ model.currentSeasonGames }} current-season games incorporated<span *ngIf="model.resultsThrough"> through {{ dateTime(model.resultsThrough) }}</span>.</span></div>
            <details class="nba-calibration">
              <summary>VIEW OUT-OF-SAMPLE CALIBRATION BY PROBABILITY RANGE</summary>
              <table><thead><tr><th>MODEL RANGE</th><th>GAMES</th><th>PREDICTED HOME</th><th>OBSERVED HOME WINS</th></tr></thead>
              <tbody><tr *ngFor="let bucket of model.calibration"><td>{{ bucket.bucket }}</td><td>{{ bucket.games }}</td><td>{{ bucket.predicted === null ? '—' : percent(bucket.predicted) }}</td><td>{{ bucket.observed === null ? '—' : percent(bucket.observed) }}</td></tr></tbody></table>
              <p>Historical validation is not a guarantee of future calibration. The model does not assess betting value.</p>
            </details>
          </ng-container>
          <div *ngIf="!data.games.length" class="empty-state">No regular-season NBA games were found in the current 24-hour window.</div>

          <div class="nba-matchup" *ngFor="let game of data.games; trackBy: trackGame">
            <div class="nba-matchup-top">
              <div class="nba-matchup-date"><span class="nba-status" [class.in-progress]="game.status === 'live'">{{ game.statusDetail }}</span><span>{{ dateTime(game.startTime) }}</span></div>
              <span class="nba-matchup-id">ESPN #{{ game.gameId }}</span>
            </div>
            <div class="nba-teams">
              <div class="nba-team"><span class="nba-location">AWAY</span><strong>{{ game.away.name }}</strong><span class="nba-team-record">{{ game.away.record ?? 'Record unavailable' }}</span></div>
              <div class="nba-versus"><strong *ngIf="game.status === 'scheduled'">VS</strong><strong *ngIf="game.status !== 'scheduled'">{{ game.awayScore ?? '—' }} : {{ game.homeScore ?? '—' }}</strong><small>{{ game.status === 'scheduled' ? 'MATCHUP' : game.status | uppercase }}</small></div>
              <div class="nba-team"><span class="nba-location">HOME</span><strong>{{ game.home.name }}</strong><span class="nba-team-record">{{ game.home.record ?? 'Record unavailable' }}</span></div>
            </div>

            <div *ngIf="game.forecast as projection" class="nba-forecast">
              <div class="nba-forecast-heading"><span>PREGAME ELO ESTIMATE · EXPERIMENTAL</span><small>Home-court adjustment included</small></div>
              <div class="nba-forecast-labels"><span>{{ game.away.abbreviation }} <strong>{{ percent(projection.awayWinProbability) }}</strong></span><span>{{ game.home.abbreviation }} <strong>{{ percent(projection.homeWinProbability) }}</strong></span></div>
              <div class="nba-probability-track" role="img" [attr.aria-label]="game.away.abbreviation + ' modeled win probability ' + percent(projection.awayWinProbability) + ', ' + game.home.abbreviation + ' ' + percent(projection.homeWinProbability)">
                <span class="nba-prob-away" [style.width.%]="projection.awayWinProbability * 100"></span><span class="nba-prob-home" [style.width.%]="projection.homeWinProbability * 100"></span>
              </div>
              <div class="nba-forecast-note">Elo {{ projection.awayElo.toFixed(0) }} / {{ projection.homeElo.toFixed(0) }} · Pregame estimate only; not adjusted for reported injuries.</div>
            </div>
            <p *ngIf="game.status === 'scheduled' && !game.forecast" class="nba-forecast-missing">Pregame model unavailable; verified team statistics remain available.</p>

            <div class="nba-stat-section-label">SEASON PERFORMANCE · {{ game.away.abbreviation }} / {{ game.home.abbreviation }}</div>
            <table class="nba-stat-table" [attr.aria-label]="game.away.name + ' versus ' + game.home.name + ' season statistics'">
              <thead><tr><th>{{ game.away.abbreviation }}</th><th>METRIC</th><th>{{ game.home.abbreviation }}</th></tr></thead>
              <tbody>
                <tr><td>{{ game.away.lastTen ?? '—' }}</td><td>Last 10 games</td><td>{{ game.home.lastTen ?? '—' }}</td></tr>
                <tr><td>{{ game.away.awayRecord ?? '—' }}</td><td>Away / home record</td><td>{{ game.home.homeRecord ?? '—' }}</td></tr>
                <tr><td>{{ points(game.away.pointsFor) }}</td><td>Points scored / game</td><td>{{ points(game.home.pointsFor) }}</td></tr>
                <tr><td>{{ points(game.away.pointsAgainst) }}</td><td>Points allowed / game</td><td>{{ points(game.home.pointsAgainst) }}</td></tr>
                <tr><td>{{ points(game.away.differential, true) }}</td><td>Point differential</td><td>{{ points(game.home.differential, true) }}</td></tr>
                <tr><td>{{ game.away.streak ?? '—' }}</td><td>Current streak</td><td>{{ game.home.streak ?? '—' }}</td></tr>
              </tbody>
            </table>

            <div class="nba-detail-grid">
              <details class="nba-detail" [attr.aria-label]="'Head-to-head history for ' + game.away.name + ' and ' + game.home.name">
                <summary>RECENT HEAD-TO-HEAD <span>{{ game.away.abbreviation }} {{ game.headToHead.awayWins }}–{{ game.headToHead.homeWins }} {{ game.home.abbreviation }}</span></summary>
                <p *ngIf="!game.headToHead.meetings.length">No recent completed regular-season meetings were returned.</p>
                <ul *ngIf="game.headToHead.meetings.length">
                  <li *ngFor="let meeting of game.headToHead.meetings">{{ shortDate(meeting.date) }} · {{ meeting.homeId === game.home.id ? game.home.abbreviation : game.away.abbreviation }} {{ meeting.homeScore }} – {{ meeting.awayId === game.away.id ? game.away.abbreviation : game.home.abbreviation }} {{ meeting.awayScore }}</li>
                </ul>
                <p *ngIf="game.headToHead.partial" class="nba-data-note">Some schedule sources failed. Record may be incomplete.</p>
                <p class="nba-data-note">Up to five completed meetings from this and the prior regular season.</p>
              </details>
              <details class="nba-detail" [attr.aria-label]="'Injury reports for ' + game.away.name + ' and ' + game.home.name">
                <summary>REPORTED INJURIES <span>{{ game.injuries.away.length + game.injuries.home.length }} listed</span></summary>
                <p *ngIf="!game.injuries.available" class="nba-data-note">Some injury feeds or team reports are unavailable. An empty list is not proof of a healthy roster.</p>
                <div class="nba-injury-team"><strong>{{ game.away.abbreviation }}</strong><span *ngIf="!game.injuries.away.length">No entries returned</span><div *ngFor="let injury of game.injuries.away" class="nba-injury-entry"><b>{{ injury.name }}</b> · {{ injury.status }}<small *ngIf="injury.note">{{ injury.note }}</small></div></div>
                <div class="nba-injury-team"><strong>{{ game.home.abbreviation }}</strong><span *ngIf="!game.injuries.home.length">No entries returned</span><div *ngFor="let injury of game.injuries.home" class="nba-injury-entry"><b>{{ injury.name }}</b> · {{ injury.status }}<small *ngIf="injury.note">{{ injury.note }}</small></div></div>
                <p class="nba-data-note" *ngIf="game.injuries.reportedAt">Report snapshot: {{ dateTime(game.injuries.reportedAt) }}. Not a confirmed starting lineup.</p>
              </details>
            </div>
          </div>
          <div class="nba-footnote">ESPN-reported statistics and injuries may lag official updates. Elo provides an independent *experimental* estimate; it is not a calibrated sportsbook line, verified lineup forecast or demonstrated betting edge. ESPN's public JSON feeds are subject to change.</div>
        </ng-container>
      </section>

      <section class="radar-panel catalog-panel" id="sports-catalog" aria-label="Full Kalshi Sports catalog">
        <div class="panel-heading">
          <div>
            <div class="section-kicker">01 / FULL SPORTS BOOK</div>
            <h2>Every price. Every listed sport. <span class="heading-count">{{ catalog()?.indexedMarkets ?? '—' }} discovered</span></h2>
            <p>Cursor-based discovery of open standard Sports events, without price bands, league whitelists or a top-market cutoff.</p>
          </div>
          <span class="panel-pill" [class.catalog-building]="!catalog()?.complete">{{ catalog()?.complete ? 'TRAVERSAL COMPLETE' : 'INDEXING / PARTIAL' }}</span>
        </div>
        <div class="catalog-progress" *ngIf="catalog() as data">
          <span><strong>{{ data.mode === 'indexed' ? 'INDEXED' : 'LIVE BROWSE' }}</strong> · {{ data.scannedPages }} provider {{ data.scannedPages === 1 ? 'page' : 'pages' }} traversed</span>
          <span>{{ data.scannedSportsEvents }} Sports events found · updated {{ dateTime(data.updatedAt) }}</span>
        </div>
        <div *ngFor="let warning of catalog()?.warnings ?? []" class="catalog-notice">{{ warning }}</div>
        <p class="catalog-notice" *ngIf="catalogError()" role="alert">Full-book feed: {{ catalogError() }}</p>
        <p class="catalog-notice" *ngIf="catalogLoading() && !catalog()">Discovering public Sports markets…</p>
        <div class="catalog-controls">
          <label class="catalog-control-label">SEARCH LOADED CONTRACTS
            <input type="search" [value]="catalogQuery()" (input)="catalogQuery.set($any($event.target).value)" placeholder="Team, title, ticker…" aria-label="Search loaded Sports contracts" />
          </label>
          <label class="catalog-control-label">SPORT
            <select [value]="catalogSport()" (change)="selectCatalogSport($any($event.target).value)" aria-label="Filter indexed Sports contracts by sport">
              <option value="ALL">ALL SPORTS</option>
              <option *ngFor="let sport of catalogSports()" [value]="sport">{{ sport }}</option>
            </select>
          </label>
          <div class="catalog-filter-count">{{ catalogFiltered().length }} matching / {{ catalogMarkets().length }} loaded</div>
        </div>
        <ng-container *ngTemplateOutlet="marketsTable; context: { rows: catalogFiltered(), empty: catalogLoading() ? 'Fetching Sports markets…' : catalogEmpty() }"></ng-container>
        <div class="catalog-load" *ngIf="catalogCursor() || catalogLoading()">
          <span>Sport selection searches indexed pages; text search applies to results loaded on this screen.</span>
          <button class="refresh-button" type="button" (click)="loadMoreCatalog()" [disabled]="catalogLoading() || !catalogCursor()">{{ catalogLoading() ? 'LOADING…' : 'LOAD MORE CONTRACTS' }}</button>
        </div>
        <p class="catalog-footer">An indexed traversal takes time and is not a simultaneous order-book snapshot. Quotes may change while the scan runs. This panel does not calculate EV without a matched independent forecast.</p>
      </section>

      <section class="stat-strip" aria-label="Radar overview">
        <div class="stat-item"><span class="stat-label">SPORTS BOOK INDEX</span><strong>{{ catalog()?.indexedMarkets ?? '—' }}</strong><small>{{ catalog()?.complete ? 'Completed standard-event traversal' : 'Discovered so far' }}</small></div>
        <div class="stat-item"><span class="stat-label">PAGES TRAVERSED</span><strong>{{ catalog()?.scannedPages ?? '—' }}</strong><small>{{ catalog()?.mode === 'indexed' ? 'Background cursor scan' : 'Live browsing' }}</small></div>
        <div class="stat-item"><span class="stat-label">DATA UPDATED</span><strong class="time-stat">{{ timeLabel() }}</strong><small>Automatic 30-minute refresh</small></div>
        <div class="stat-item"><span class="stat-label">MODEL STATUS</span><strong class="model-stat">NBA ELO</strong><small>Historical backtest; no edge claim</small></div>
      </section>

      <div class="feed-note">
        <span class="feed-note-icon">i</span>
        <span><strong>Know what you're seeing.</strong> YES ask is Kalshi's quoted price—not our independent win probability. Movement compares the current last trade with Kalshi's previous-price field, not necessarily 30 minutes ago.</span>
      </div>

      <div *ngIf="error()" class="error-panel" role="alert">
        <strong>Market feed could not be loaded.</strong>
        <span>{{ error() }}</span>
        <small>There are no simulated prices or fabricated results in this dashboard.</small>
      </div>

      <ng-container *ngIf="snapshot() as data">
        <div *ngIf="data.counts.partialCoverage" class="coverage-note"><span class="coverage-dash"></span> The legacy 30-minute price-history sampler covers selected sports series; the full catalog above is indexed independently.</div>

      </ng-container>

      <section class="history-panel" *ngIf="selectedMarket() as selected">
          <div class="history-heading">
            <div><div class="section-kicker">MARKET HISTORY / LAST 24 HOURS</div><h2>{{ selected.title }}</h2><p>{{ selected.ticker }} · Scheduled 30-minute YES ask samples</p></div>
            <button type="button" class="history-close" (click)="closeHistory()" aria-label="Close history">×</button>
          </div>
          <p class="history-message" *ngIf="historyLoading()">Loading historical samples…</p>
          <p class="history-message" *ngIf="historyError()" role="alert">{{ historyError() }}</p>
          <ng-container *ngIf="history() as series">
            <p class="history-message" *ngIf="!series.available">{{ series.message || 'Historical collection is not enabled yet.' }}</p>
            <p class="history-message" *ngIf="series.available && chartValues().length < 2">Not enough scheduled samples yet. At least two observations are required to show a trend.</p>
            <div class="chart-shell" *ngIf="chartValues().length >= 2">
              <div class="chart-stats"><span>{{ cents(chartMin()) }} <small>LOW</small></span><span>{{ cents(chartMax()) }} <small>HIGH</small></span><span>{{ chartValues().length }} <small>SAMPLES</small></span></div>
              <svg class="history-chart" viewBox="0 0 800 220" role="img" [attr.aria-label]="'YES ask price over the last 24 hours for ' + selected.ticker">
                <line x1="20" y1="30" x2="780" y2="30" class="chart-gridline" />
                <line x1="20" y1="110" x2="780" y2="110" class="chart-gridline" />
                <line x1="20" y1="190" x2="780" y2="190" class="chart-gridline" />
                <polyline *ngFor="let segment of chartSegments()" [attr.points]="segment" class="chart-line" />
                <circle *ngFor="let point of chartPlots()" [attr.cx]="point.x" [attr.cy]="point.y" r="3.5" class="chart-dot" />
              </svg>
              <div class="chart-timestamps"><span>{{ chartStart() }}</span><span>{{ chartEnd() }}</span></div>
            </div>
          </ng-container>
          <p class="history-disclaimer">Samples are collected on a fixed schedule. Gaps indicate missing observations; they are not interpolated trades.</p>
      </section>

      <ng-container *ngIf="snapshot() as data">
        <section class="radar-panel">
          <div class="panel-heading">
            <div><div class="section-kicker">02 / SAMPLED EVENT WINDOW</div><h2>Upcoming games <span class="heading-count">{{ games().length }}</span></h2><p>Open sports contracts associated with games in the next 24 hours, from the legacy price-history sample.</p></div>
            <span class="panel-pill">ROLLING 24H</span>
          </div>
          <ng-container *ngTemplateOutlet="marketsTable; context: { rows: games(), empty: 'No upcoming game markets returned in this scan.' }"></ng-container>
        </section>

        <section class="radar-panel championships-panel">
          <div class="panel-heading">
            <div><div class="section-kicker">03 / SAMPLED FUTURES DESK</div><h2>Championship watch <span class="heading-count">{{ championships().length }}</span></h2><p>Season-long and title markets from the legacy price-history sample.</p></div>
            <span class="panel-pill purple">FUTURES</span>
          </div>
          <ng-container *ngTemplateOutlet="marketsTable; context: { rows: championships(), empty: 'No championship markets returned in this scan.' }"></ng-container>
        </section>

        <section class="radar-panel other-panel" *ngIf="others().length">
          <div class="panel-heading">
            <div><div class="section-kicker">04 / ADDITIONAL COVERAGE</div><h2>Other sports contracts <span class="heading-count">{{ others().length }}</span></h2><p>Sports markets not yet classified as upcoming games or championships.</p></div>
          </div>
          <ng-container *ngTemplateOutlet="marketsTable; context: { rows: others(), empty: '' }"></ng-container>
        </section>
      </ng-container>

      <ng-template #marketsTable let-rows="rows" let-empty="empty">
        <div *ngIf="!rows.length" class="empty-state">{{ empty }}</div>
        <div class="table-wrap" *ngIf="rows.length">
          <table>
            <thead><tr><th>SPORT / MARKET</th><th class="numeric">YES BID</th><th class="numeric">YES ASK</th><th class="numeric">CHANGE*</th><th class="numeric">24H VOL.</th><th class="numeric">SPREAD</th><th>HISTORY</th></tr></thead>
            <tbody>
              <tr *ngFor="let row of rows; trackBy: trackTicker">
                <td class="market-identity"><div class="identity-top"><span class="sport-chip">{{ row.sport }}</span><span class="market-ticker">{{ row.ticker }}</span></div><div class="market-title">{{ row.title }}</div><div class="event-title">{{ row.eventTitle }}</div></td>
                <td class="numeric price-muted">{{ cents(row.yesBid) }}</td>
                <td class="numeric main-price">{{ cents(row.yesAsk) }}</td>
                <td class="numeric"><span class="movement" [class.positive]="(row.priceChange ?? 0) > 0" [class.negative]="(row.priceChange ?? 0) < 0">{{ changeLabel(row.priceChange) }}</span></td>
                <td class="numeric">{{ volume(row.volume24h) }}</td>
                <td class="numeric price-muted">{{ spread(row) }}</td>
                <td><button class="history-button" type="button" (click)="showHistory(row)" [attr.aria-label]="'View historical prices for ' + row.title">VIEW ↗</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </ng-template>

      <footer class="footer"><div><strong>OPEN SPORTS INTELLIGENCE</strong><span>Independent by design. Transparent by default.</span></div><div>Sources: ESPN public basketball feeds + Kalshi public markets · Experimental Elo predictions · No verified edge or account integration.</div></footer>
    </main>
  </div>
  `
})
export class AppComponent implements OnInit, OnDestroy {
  readonly catalog = signal<SportsCatalogResponse | null>(null);
  readonly catalogMarkets = signal<RadarMarket[]>([]);
  readonly catalogCursor = signal<string | null>(null);
  readonly catalogLoading = signal(false);
  readonly catalogError = signal<string | null>(null);
  readonly catalogQuery = signal('');
  readonly catalogSport = signal('ALL');
  readonly catalogSports = computed(() => [...new Set([
    'NBA', 'WNBA', 'NFL', 'NHL', 'MLB', 'SOCCER', 'UFC', 'F1', 'OTHER SPORTS',
    ...this.catalogMarkets().map((market) => market.sport)
  ])].sort());
  readonly catalogFiltered = computed(() => {
    const query = this.catalogQuery().trim().toLowerCase();
    const sport = this.catalogSport();
    return this.catalogMarkets().filter((market) =>
      (sport === 'ALL' || market.sport === sport) &&
      (!query || [market.title, market.eventTitle, market.ticker, market.sport].some((value) => value.toLowerCase().includes(query)))
    );
  });
  readonly catalogEmpty = computed(() => this.catalogQuery().trim()
    ? 'No loaded contracts match this search. Clear the text filter or load more.'
    : this.catalogSport() !== 'ALL'
      ? `No ${this.catalogSport()} contracts found in indexed pages yet. Refresh as the scan progresses.`
      : 'No matching markets loaded yet. Clear the search or load more pages.');
  readonly nba = signal<NbaComparisonResponse | null>(null);
  readonly nbaLoading = signal(false);
  readonly nbaError = signal<string | null>(null);
  readonly snapshot = signal<RadarResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly games = computed(() => this.snapshot()?.markets.filter((m) => m.kind === 'game') ?? []);
  readonly championships = computed(() => this.snapshot()?.markets.filter((m) => m.kind === 'championship') ?? []);
  readonly others = computed(() => this.snapshot()?.markets.filter((m) => m.kind === 'other') ?? []);
  readonly selectedMarket = signal<RadarMarket | null>(null);
  readonly history = signal<RadarHistoryResponse | null>(null);
  readonly historyLoading = signal(false);
  readonly historyError = signal<string | null>(null);
  readonly chartValues = computed(() => this.history()?.points.filter((point) =>
    point.yesAsk !== null && Number.isFinite(point.yesAsk)
  ) ?? []);
  readonly chartMin = computed(() => Math.min(...this.chartValues().map((point) => point.yesAsk!), 1));
  readonly chartMax = computed(() => Math.max(...this.chartValues().map((point) => point.yesAsk!), 0));
  readonly chartPlots = computed(() => {
    const values = this.chartValues();
    if (values.length < 2) return [];
    const min = Math.max(0, this.chartMin() - 0.03);
    const max = Math.min(1, this.chartMax() + 0.03);
    const span = Math.max(0.01, max - min);
    const start = Date.parse(values[0].sampledAt);
    const duration = Math.max(1, Date.parse(values[values.length - 1].sampledAt) - start);
    return values.map((point) => {
      const x = 20 + (760 * (Date.parse(point.sampledAt) - start)) / duration;
      const y = 190 - ((point.yesAsk! - min) / span) * 160;
      return { x: x.toFixed(1), y: y.toFixed(1), sampledAt: point.sampledAt };
    });
  });
  readonly chartSegments = computed(() => {
    const segments: string[] = [];
    let group: string[] = [];
    let previous = 0;
    for (const point of this.chartPlots()) {
      const timestamp = Date.parse(point.sampledAt);
      if (previous && timestamp - previous > 45 * 60 * 1000) {
        if (group.length > 1) segments.push(group.join(' '));
        group = [];
      }
      group.push(`${point.x},${point.y}`);
      previous = timestamp;
    }
    if (group.length > 1) segments.push(group.join(' '));
    return segments;
  });
  readonly chartStart = computed(() => this.chartValues().length ? this.historyTime(this.chartValues()[0].sampledAt) : '—');
  readonly chartEnd = computed(() => this.chartValues().length ? this.historyTime(this.chartValues()[this.chartValues().length - 1].sampledAt) : '—');
  private timer: ReturnType<typeof setInterval> | undefined;
  private historyRequestId = 0;
  private nbaRequestId = 0;
  private catalogRequestId = 0;

  ngOnInit(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.historyRequestId++;
    this.nbaRequestId++;
    this.catalogRequestId++;
  }

  async showHistory(market: RadarMarket): Promise<void> {
    const requestId = ++this.historyRequestId;
    this.selectedMarket.set(market);
    this.history.set(null);
    this.historyError.set(null);
    this.historyLoading.set(true);
    try {
      const response = await fetch(`/api/history?ticker=${encodeURIComponent(market.ticker)}`);
      if (!response.ok) throw new Error(`History API returned HTTP ${response.status}.`);
      const data: RadarHistoryResponse = await response.json();
      if (!Array.isArray(data.points)) throw new Error('Unexpected history response.');
      if (requestId === this.historyRequestId) this.history.set(data);
    } catch (error) {
      if (requestId === this.historyRequestId) this.historyError.set(error instanceof Error ? error.message : 'History unavailable.');
    } finally {
      if (requestId === this.historyRequestId) this.historyLoading.set(false);
    }
  }

  closeHistory(): void {
    this.historyRequestId++;
    this.selectedMarket.set(null);
    this.history.set(null);
  }

  historyTime(timestamp: string): string {
    return new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  async refresh(force = false): Promise<void> {
    void this.refreshNba(force);
    void this.refreshCatalog();
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const path = force ? '/api/markets?fresh=1' : '/api/markets';
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Market API returned HTTP ${response.status}.`);
      const data: RadarResponse = await response.json();
      if (!data || !Array.isArray(data.markets) || !data.counts) throw new Error('Unexpected market API response.');
      this.snapshot.set(data);
    } catch (cause) {
      this.error.set(cause instanceof Error ? cause.message : 'Unexpected connection error.');
    } finally {
      this.loading.set(false);
    }
  }

  async refreshCatalog(): Promise<void> {
    if (this.catalogLoading()) return;
    const requestId = ++this.catalogRequestId;
    this.catalogLoading.set(true);
    this.catalogError.set(null);
    try {
      const filter = this.catalogSport() === 'ALL' ? '' : `?sport=${encodeURIComponent(this.catalogSport())}`;
      const response = await fetch(`/api/catalog${filter}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}; retry later.`);
      const data: SportsCatalogResponse = await response.json();
      if (!Array.isArray(data?.markets) || !Array.isArray(data?.warnings)) throw new Error('Unexpected Sports catalog response.');
      if (requestId !== this.catalogRequestId) return;
      this.catalog.set(data);
      this.catalogMarkets.set(data.markets);
      this.catalogCursor.set(data.nextCursor);
    } catch (error) {
      if (requestId === this.catalogRequestId) this.catalogError.set(error instanceof Error ? error.message : 'Sports catalog unavailable.');
    } finally {
      if (requestId === this.catalogRequestId) this.catalogLoading.set(false);
    }
  }

  selectCatalogSport(sport: string): void {
    if (this.catalogSport() === sport && this.catalog()) return;
    // Cancel an outstanding catalog request; results from a previous filter
    // must not silently overwrite a newly selected sport.
    this.catalogRequestId++;
    this.catalogLoading.set(false);
    this.catalogSport.set(sport);
    this.catalog.set(null);
    this.catalogMarkets.set([]);
    this.catalogCursor.set(null);
    void this.refreshCatalog();
  }

  async loadMoreCatalog(): Promise<void> {
    const cursor = this.catalogCursor();
    if (this.catalogLoading() || !cursor) return;
    const requestId = ++this.catalogRequestId;
    this.catalogLoading.set(true);
    this.catalogError.set(null);
    try {
      const params = new URLSearchParams({ cursor });
      if (this.catalogSport() !== 'ALL') params.set('sport', this.catalogSport());
      const response = await fetch(`/api/catalog?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}; retry later.`);
      const data: SportsCatalogResponse = await response.json();
      if (!Array.isArray(data?.markets) || !Array.isArray(data?.warnings)) throw new Error('Unexpected Sports catalog page.');
      if (requestId !== this.catalogRequestId) return;
      const seen = new Set(this.catalogMarkets().map((market) => market.ticker));
      this.catalogMarkets.update((current) => [...current, ...data.markets.filter((market) => {
        if (seen.has(market.ticker)) return false;
        seen.add(market.ticker);
        return true;
      })]);
      this.catalog.set(data);
      this.catalogCursor.set(data.nextCursor);
    } catch (error) {
      if (requestId === this.catalogRequestId) this.catalogError.set(error instanceof Error ? error.message : 'Could not load the next page.');
    } finally {
      if (requestId === this.catalogRequestId) this.catalogLoading.set(false);
    }
  }

  async refreshNba(force = false): Promise<void> {
    if (this.nbaLoading()) return;
    const requestId = ++this.nbaRequestId;
    this.nbaLoading.set(true);
    this.nbaError.set(null);
    try {
      const response = await fetch(force ? '/api/nba/comparisons?fresh=1' : '/api/nba/comparisons', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}; retry later.`);
      const data: NbaComparisonResponse = await response.json();
      if (!Array.isArray(data?.games) || !data.fetchedAt) throw new Error('Unexpected NBA comparison response.');
      if (requestId === this.nbaRequestId) this.nba.set(data);
    } catch (error) {
      if (requestId === this.nbaRequestId) this.nbaError.set(error instanceof Error ? error.message : 'NBA feed unavailable.');
    } finally {
      if (requestId === this.nbaRequestId) this.nbaLoading.set(false);
    }
  }

  points(value: number | null, signed = false): string {
    if (value === null || !Number.isFinite(value)) return '—';
    const rounded = value.toFixed(1);
    return signed && value > 0 ? `+${rounded}` : rounded;
  }

  percent(value: number): string {
    return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
  }

  dateTime(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    }) : 'Time unavailable';
  }

  shortDate(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles'
    }) : 'Date unavailable';
  }

  trackGame(_: number, game: NbaComparison): string { return game.gameId; }

  timeLabel(): string {
    const timestamp = this.snapshot()?.scannedAt;
    if (!timestamp) return 'AWAITING';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  }

  cents(value: number | null): string {
    return value === null || !Number.isFinite(value) ? '—' : `${Math.round(value * 100)}¢`;
  }

  changeLabel(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return '—';
    const cents = Math.round(value * 100);
    return `${cents > 0 ? '+' : ''}${cents}¢`;
  }

  volume(value: number): string {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  spread(row: RadarMarket): string {
    return row.yesBid === null || row.yesAsk === null ? '—' : `${Math.round((row.yesAsk - row.yesBid) * 100)}¢`;
  }

  trackTicker(_: number, row: RadarMarket): string {
    return row.ticker;
  }
}
