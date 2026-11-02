import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import type { NbaComparison, NbaComparisonResponse, NbaEvResponse, RadarHistoryResponse, RadarMarket, RadarResponse, SportsCatalogResponse } from './market.model';

const REFRESH_MS = 30 * 60 * 1000;
const DEFAULT_LIST_SIZE = 8;

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
        <div class="eyebrow"><span class="eyebrow-line"></span> OPEN SPORTS INTELLIGENCE <span class="version-tag">V0.6 / FOCUSED RADAR</span></div>
        <h1>Find the <span>price gap.</span></h1>
        <p class="hero-copy">Kalshi prices and NBA model comparisons at a glance. Start with the strongest estimated gaps, then open matchup research or the full market catalog when you need it.</p>
        <div class="hero-actions">
          <span class="source-state"><span class="source-pulse"></span> {{ loading() ? 'SCANNING PUBLIC FEED' : error() ? 'KALSHI FEED UNAVAILABLE' : 'KALSHI PUBLIC FEED' }}</span>
          <button class="refresh-button" type="button" (click)="refresh(true)" [disabled]="loading() || nbaLoading() || evLoading()" [attr.aria-busy]="loading() || nbaLoading() || evLoading()">
            <span aria-hidden="true" class="refresh-icon" [class.spinning]="loading()">↻</span>
            {{ loading() || nbaLoading() ? 'SCANNING' : 'REFRESH DATA' }}
          </button>
        </div>
      </section>

      <nav class="workspace-tabs" aria-label="Dashboard views" role="tablist">
        <button type="button" role="tab" id="tab-scanner" aria-controls="panel-scanner" [attr.aria-selected]="activeView() === 'scanner'" [class.active]="activeView() === 'scanner'" (click)="setView('scanner')"><span>OPPORTUNITIES</span><small>Kalshi model EV</small></button>
        <button type="button" role="tab" id="tab-research" aria-controls="panel-research" [attr.aria-selected]="activeView() === 'research'" [class.active]="activeView() === 'research'" (click)="setView('research')"><span>NBA RESEARCH</span><small>Matchups & injuries</small></button>
        <button type="button" role="tab" id="tab-explorer" aria-controls="panel-explorer" [attr.aria-selected]="activeView() === 'explorer'" [class.active]="activeView() === 'explorer'" (click)="setView('explorer')"><span>MARKET EXPLORER</span><small>All indexed Sports</small></button>
      </nav>

      <div *ngIf="activeView() === 'research'" id="panel-research" role="tabpanel" aria-labelledby="tab-research">
      <section class="radar-panel nba-panel" aria-label="NBA matchup comparisons">
        <div class="panel-heading">
          <div>
            <div class="section-kicker">NBA / MATCHUP RESEARCH</div>
            <h2>Side-by-side comparisons <span class="heading-count">{{ nba()?.games?.length ?? '—' }}</span></h2>
            <p>Season form, recent meetings, reported injuries and experimental pregame Elo estimates.</p>
          </div>
          <div class="nba-panel-actions"><button class="catalog-nba-shortcut" type="button" (click)="openNbaMarkets()">VIEW NBA MARKETS ↗</button><span class="panel-pill nba-pill">2026–27 SEASON</span></div>
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

          <div class="nba-matchup" *ngFor="let game of visibleNbaGames(); trackBy: trackGame">
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

            <details class="matchup-deep-dive">
              <summary>SEASON STATS, HEAD-TO-HEAD &amp; INJURY REPORTS <span>EXPAND DETAILS ↓</span></summary>
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
            </details>
          </div>
          <div class="list-progress" *ngIf="data.games.length > visibleNbaGames().length"><span>Showing {{ visibleNbaGames().length }} of {{ data.games.length }} matchups</span><button type="button" class="history-button" (click)="showMoreNba()">SHOW MORE MATCHUPS ↓</button></div>
          <div class="nba-footnote">ESPN-reported statistics and injuries may lag official updates. Elo provides an independent *experimental* estimate; it is not a calibrated sportsbook line, verified lineup forecast or demonstrated betting edge. ESPN's public JSON feeds are subject to change.</div>
        </ng-container>
      </section>
      </div>

      <section class="radar-panel ev-panel" *ngIf="activeView() === 'scanner'" id="panel-scanner" role="tabpanel" aria-labelledby="tab-scanner" aria-label="NBA model versus Kalshi value comparison">
        <div class="panel-heading">
          <div>
            <div class="section-kicker">KALSHI / NBA MODEL EV</div>
            <h2>Opportunity watch <span class="heading-count">{{ evPositiveCount() }} positive estimates</span></h2>
            <p>Upcoming NBA winners · Kalshi ask compared with Elo · Sorted by estimated model EV.</p>
          </div>
          <span class="panel-pill ev-pill">KALSHI ONLY · MODEL-BASED</span>
        </div>
        <p class="nba-state" *ngIf="evLoading() && !ev()">Checking upcoming NBA games, live prices and series fees…</p>
        <p *ngIf="evError()" class="nba-warning" role="alert">NBA EV desk: {{ evError() }}</p>
        <ng-container *ngIf="ev() as data">
          <div class="ev-summary">
            <div><span>GAME MATCHES</span><strong>{{ data.counts.matchedGames }} <small>/ {{ data.counts.scheduledGames }} upcoming</small></strong></div>
            <div><span>QUOTES COMPARED</span><strong>{{ data.counts.comparedOffers }}</strong></div>
            <div><span>LAST QUOTE CHECK</span><strong class="ev-time">{{ dateTime(data.fetchedAt) }}</strong></div>
          </div>
          <div *ngFor="let warning of data.warnings" class="ev-warning">{{ warning }}</div>
          <div *ngIf="!data.model.available" class="ev-warning">Current Elo ratings could not be verified. EV estimates are withheld.</div>
          <div class="ev-toolbar">
            <label class="ev-toggle"><input type="checkbox" [checked]="evOnlyPositive()" (change)="setPositiveOnly($any($event.target).checked)" /> Positive estimates only</label>
            <span>{{ visibleEvRows().length }} of {{ evRows().length }} · highest estimate first</span>
          </div>
          <div class="ev-opportunities" *ngIf="evRows().length">
            <article class="ev-card" *ngFor="let row of visibleEvRows(); trackBy: trackEvOffer">
              <div class="ev-card-event"><span class="ev-card-date">{{ dateTime(row.startTime) }}</span><strong>{{ row.team }}</strong><span>{{ row.away }} @ {{ row.home }}</span><small>KALSHI · {{ row.side }} ON {{ row.yesMarketTeam }}</small></div>
              <div class="ev-card-numbers"><div><small>ASK</small><strong>{{ cents(row.ask) }}</strong></div><div><small>ELO WIN</small><strong>{{ percent(row.modelProbability) }}</strong></div><div><small>MODEL EV*</small><strong class="ev-value" [class.ev-positive]="(row.illustrativeNetEv ?? 0) > 0" [class.ev-negative]="(row.illustrativeNetEv ?? 0) <= 0">{{ signedCents(row.illustrativeNetEv) }}</strong></div></div>
              <div class="ev-card-actions"><a class="history-button" [href]="'https://kalshi.com/markets/kxnbagame/event/' + row.eventTicker.toLowerCase()" target="_blank" rel="noopener noreferrer">VIEW MARKET ↗</a><details class="ev-card-extra"><summary>PRICE DETAILS</summary><span>Gross model gap: {{ signedCents(row.grossEdge) }} · Est. fee: {{ preciseCents(row.feePerContract) }} · Break-even: {{ row.breakEvenProbability === null ? '—' : percent(row.breakEvenProbability) }} · {{ row.ticker }}</span></details></div>
            </article>
          </div>
          <div class="list-progress" *ngIf="evRows().length > visibleEvRows().length"><span>Showing {{ visibleEvRows().length }} of {{ evRows().length }} comparisons</span><button type="button" class="history-button" (click)="showMoreEv()">SHOW MORE COMPARISONS ↓</button></div>
          <div class="empty-state" *ngIf="!evRows().length">{{ evOnlyPositive() && data.offers.length ? 'No positive illustrative model EV among the matching quotes.' : 'No exact, model-eligible NBA game-winner comparisons are available in this window yet.' }}</div>
          <p class="ev-data-note" *ngIf="data.unmatched.length">{{ data.unmatched.length }} upcoming games could not be matched exactly and are excluded. <button type="button" (click)="setView('research')">RESEARCH MATCHUPS →</button></p>
          <p class="catalog-footer">*Illustrative EV per $1-settlement contract = model win probability − quoted ask − estimated standard taker fee per contract (assuming one 100-contract order). Fee is based on Kalshi's live KXNBAGAME series multiplier; actual fills, fees, and availability may differ. A positive estimate is not demonstrated profitability.</p>
        </ng-container>
      </section>

      <div *ngIf="activeView() === 'explorer'" id="panel-explorer" role="tabpanel" aria-labelledby="tab-explorer">
      <section class="radar-panel catalog-panel" id="sports-catalog" aria-label="Full Kalshi Sports catalog">
        <div class="panel-heading">
          <div>
            <div class="section-kicker">FULL SPORTS CATALOG · KALSHI</div>
            <h2>Find a market <span class="heading-count">{{ catalog()?.indexedMarkets ?? '—' }} indexed</span></h2>
            <p>Search all available prices and select the sport and market type that matter to you.</p>
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
            <input type="search" [value]="catalogQuery()" (input)="setCatalogQuery($any($event.target).value)" placeholder="Team, title, ticker…" aria-label="Search loaded Sports contracts" />
          </label>
          <label class="catalog-control-label">SPORT
            <select [value]="catalogSport()" (change)="selectCatalogSport($any($event.target).value)" aria-label="Filter indexed Sports contracts by sport">
              <option value="ALL">ALL SPORTS</option>
              <option *ngFor="let sport of catalogSports()" [value]="sport">{{ sport }}</option>
            </select>
          </label>
          <label class="catalog-control-label">MARKET TYPE
            <select [value]="catalogKind()" (change)="setCatalogKind($any($event.target).value)" aria-label="Filter contracts by market type">
              <option value="ALL">ALL TYPES</option><option value="game">GAMES</option><option value="championship">CHAMPIONSHIPS</option><option value="other">OTHER</option>
            </select>
          </label>
          <div class="catalog-filter-count">{{ catalogFiltered().length }} matching</div>
        </div>
        <ng-container *ngTemplateOutlet="marketsTable; context: { rows: visibleCatalog(), empty: catalogLoading() ? 'Fetching Sports markets…' : catalogEmpty() }"></ng-container>
        <div class="list-progress" *ngIf="catalogFiltered().length > visibleCatalog().length"><span>Showing {{ visibleCatalog().length }} of {{ catalogFiltered().length }} loaded matches</span><button type="button" class="history-button" (click)="showMoreCatalog()">SHOW MORE MARKETS ↓</button></div>
        <div class="catalog-load" *ngIf="catalogCursor() || catalogLoading()">
          <span>Sport selection searches indexed pages; text search applies to results loaded on this screen.</span>
          <button class="refresh-button" type="button" (click)="loadMoreCatalog()" [disabled]="catalogLoading() || !catalogCursor()">{{ catalogLoading() ? 'LOADING…' : 'LOAD MORE CONTRACTS' }}</button>
        </div>
        <p class="catalog-footer">Search and type filters apply to currently loaded results; sport filtering searches the D1 index. This is not a simultaneous live-book snapshot.</p>
      </section>

      <div *ngIf="error()" class="error-panel" role="alert">
        <strong>Market feed could not be loaded.</strong>
        <span>{{ error() }}</span>
        <small>There are no simulated prices or fabricated results in this dashboard.</small>
      </div>

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

      <details class="archive-section" *ngIf="snapshot() as data">
        <summary>OLDER SAMPLED GROUPS <span>Hidden by default · {{ games().length + championships().length + others().length }} sampled contracts</span></summary>
        <p>These are historical 30-minute sampler snapshots, not a full market scan. Showing up to eight per group; use the catalog above for the broader index.</p>
        <h3>Upcoming games</h3><ng-container *ngTemplateOutlet="marketsTable; context: { rows: games().slice(0, 8), empty: 'No sampled games.' }"></ng-container>
        <h3>Championships</h3><ng-container *ngTemplateOutlet="marketsTable; context: { rows: championships().slice(0, 8), empty: 'No sampled championships.' }"></ng-container>
        <h3>Other</h3><ng-container *ngTemplateOutlet="marketsTable; context: { rows: others().slice(0, 8), empty: 'No other sampled markets.' }"></ng-container>
      </details>

      <ng-template #marketsTable let-rows="rows" let-empty="empty">
        <div *ngIf="!rows.length" class="empty-state">{{ empty }}</div>
        <div class="market-cards" *ngIf="rows.length">
          <article class="market-card" *ngFor="let row of rows; trackBy: trackTicker">
            <div class="market-card-title"><div class="identity-top"><span class="sport-chip">{{ row.sport }}</span><span class="sport-chip market-kind">{{ row.kind }}</span></div><strong>{{ row.title }}</strong><span>{{ row.eventTitle }}</span><small>{{ row.ticker }}</small></div>
            <div class="market-card-prices"><div><small>YES ASK</small><strong>{{ cents(row.yesAsk) }}</strong></div><div><small>NO ASK</small><strong>{{ cents(row.noAsk) }}</strong></div><div><small>SPREAD</small><strong>{{ spread(row) }}</strong></div><div><small>24H VOL.</small><strong>{{ volume(row.volume24h) }}</strong></div></div>
            <button class="history-button" type="button" (click)="showHistory(row)" [attr.aria-label]="'View historical prices for ' + row.title">HISTORY ↗</button>
          </article>
        </div>
      </ng-template>
      </div>

      <footer class="footer"><div><strong>OPEN SPORTS INTELLIGENCE</strong><span>Find the signal. Inspect the source.</span></div><div>Kalshi public odds only · ESPN NBA data for independent analysis · Experimental Elo comparisons.</div></footer>
    </main>
  </div>
  `
})
export class AppComponent implements OnInit, OnDestroy {
  readonly activeView = signal<'scanner' | 'research' | 'explorer'>('scanner');
  readonly ev = signal<NbaEvResponse | null>(null);
  readonly evLoading = signal(false);
  readonly evError = signal<string | null>(null);
  readonly evOnlyPositive = signal(true);
  readonly evLimit = signal(DEFAULT_LIST_SIZE);
  readonly evPositiveCount = computed(() => this.ev()?.offers.filter((offer) =>
    offer.illustrativeNetEv !== null && offer.illustrativeNetEv > 0).length ?? 0);
  readonly evRows = computed(() => (this.ev()?.offers ?? []).filter((offer) =>
    !this.evOnlyPositive() || (offer.illustrativeNetEv !== null && offer.illustrativeNetEv > 0)));
  readonly visibleEvRows = computed(() => this.evRows().slice(0, this.evLimit()));
  readonly catalog = signal<SportsCatalogResponse | null>(null);
  readonly catalogMarkets = signal<RadarMarket[]>([]);
  readonly catalogCursor = signal<string | null>(null);
  readonly catalogLoading = signal(false);
  readonly catalogError = signal<string | null>(null);
  readonly catalogQuery = signal('');
  readonly catalogSport = signal('ALL');
  readonly catalogKind = signal<'ALL' | 'game' | 'championship' | 'other'>('ALL');
  readonly catalogLimit = signal(DEFAULT_LIST_SIZE);
  readonly catalogSports = computed(() => [...new Set([
    'NBA', 'WNBA', 'NFL', 'NHL', 'MLB', 'SOCCER', 'UFC', 'F1', 'OTHER SPORTS',
    ...this.catalogMarkets().map((market) => market.sport)
  ])].sort());
  readonly catalogFiltered = computed(() => {
    const query = this.catalogQuery().trim().toLowerCase();
    const sport = this.catalogSport();
    const kind = this.catalogKind();
    return this.catalogMarkets().filter((market) =>
      (sport === 'ALL' || market.sport === sport) &&
      (kind === 'ALL' || market.kind === kind) &&
      (!query || [market.title, market.eventTitle, market.ticker, market.sport].some((value) => value.toLowerCase().includes(query)))
    );
  });
  readonly visibleCatalog = computed(() => this.catalogFiltered().slice(0, this.catalogLimit()));
  readonly catalogEmpty = computed(() => this.catalogQuery().trim()
    ? 'No loaded contracts match this search. Clear the text filter or load more.'
    : this.catalogSport() !== 'ALL'
      ? `No ${this.catalogSport()} contracts found in indexed pages yet. Refresh as the scan progresses.`
      : 'No matching markets loaded yet. Clear the search or load more pages.');
  readonly nba = signal<NbaComparisonResponse | null>(null);
  readonly nbaLimit = signal(DEFAULT_LIST_SIZE);
  readonly visibleNbaGames = computed(() => (this.nba()?.games ?? []).slice(0, this.nbaLimit()));
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
  private evRequestId = 0;
  private catalogRequestId = 0;

  ngOnInit(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.historyRequestId++;
    this.nbaRequestId++;
    this.evRequestId++;
    this.catalogRequestId++;
  }

  setView(view: 'scanner' | 'research' | 'explorer'): void {
    this.activeView.set(view);
  }

  openNbaMarkets(): void {
    this.setView('explorer');
    this.selectCatalogSport('NBA');
  }

  setPositiveOnly(positive: boolean): void {
    this.evOnlyPositive.set(positive);
    this.evLimit.set(DEFAULT_LIST_SIZE);
  }

  showMoreEv(): void { this.evLimit.update((limit) => limit + DEFAULT_LIST_SIZE); }
  showMoreNba(): void { this.nbaLimit.update((limit) => limit + DEFAULT_LIST_SIZE); }
  showMoreCatalog(): void { this.catalogLimit.update((limit) => limit + DEFAULT_LIST_SIZE); }

  setCatalogQuery(query: string): void {
    this.catalogQuery.set(query);
    this.catalogLimit.set(DEFAULT_LIST_SIZE);
  }

  setCatalogKind(kind: string): void {
    if (kind !== 'ALL' && kind !== 'game' && kind !== 'championship' && kind !== 'other') return;
    this.catalogKind.set(kind);
    this.catalogLimit.set(DEFAULT_LIST_SIZE);
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
    void this.refreshEv(force);
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

  async refreshEv(force = false): Promise<void> {
    if (this.evLoading()) return;
    const requestId = ++this.evRequestId;
    this.evLoading.set(true);
    this.evError.set(null);
    try {
      const response = await fetch(force ? '/api/nba/ev?fresh=1' : '/api/nba/ev', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}; retry later.`);
      const data: NbaEvResponse = await response.json();
      if (!Array.isArray(data?.offers) || !Array.isArray(data?.warnings) || !data.counts) throw new Error('Unexpected NBA EV response.');
      if (requestId === this.evRequestId) this.ev.set(data);
    } catch (error) {
      if (requestId === this.evRequestId) this.evError.set(error instanceof Error ? error.message : 'NBA comparison unavailable.');
    } finally {
      if (requestId === this.evRequestId) this.evLoading.set(false);
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
    this.catalogLimit.set(DEFAULT_LIST_SIZE);
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

  cents(value: number | null): string {
    return value === null || !Number.isFinite(value) ? '—' : `${Math.round(value * 100)}¢`;
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

  trackEvOffer(_: number, row: NbaEvResponse['offers'][number]): string {
    return `${row.eventTicker}:${row.outcome}`;
  }

  signedCents(value: number | null): string {
    return value === null || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}¢`;
  }

  preciseCents(value: number | null): string {
    return value === null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(2)}¢`;
  }
}
