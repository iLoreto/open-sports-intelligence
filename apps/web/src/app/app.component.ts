import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import type { NbaComparison, NbaComparisonResponse, NbaEvResponse, RadarHistoryResponse, RadarMarket, RadarResponse, SportsCatalogResponse } from './market.model';
import { calculatePairQuote, estimateModelStake, modeledRoi } from './opportunity-math';

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

    <header class="masthead container terminal-masthead">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"><span class="mark-bar one"></span><span class="mark-bar two"></span><span class="mark-bar three"></span><span class="mark-dot"></span></div>
        <div class="brand-text"><strong>EDGE<span class="brand-accent">/</span>FINDER</strong><span>OPEN SPORTS INTELLIGENCE</span></div>
      </div>
      <div class="header-right">
        <span class="live-label"><span class="live-dot"></span> KALSHI • CONNECTED</span>
        <button class="top-refresh" type="button" (click)="refresh(true)" [disabled]="evLoading()" [attr.aria-busy]="evLoading()"><span aria-hidden="true">↻</span> {{ evLoading() ? 'SCANNING' : 'SCAN NOW' }}</button>
      </div>
    </header>

    <main class="container terminal-container">
      <section class="hero terminal-hero discovery-hero">
        <div class="eyebrow"><span class="eyebrow-line"></span> VALUE DISCOVERY / KALSHI ONLY <span class="version-tag">V 2.0</span></div>
        <div class="hero-heading-row"><div><h1>Find the <span>edge.</span><br>Then investigate.</h1><p class="hero-copy">Rank market prices against an independent win-probability model. Select a contract to inspect its estimated value, then open the exact matchup to validate the signal.</p></div><div class="hero-quote-status"><span class="source-state"><span class="source-pulse"></span>{{ evLoading() ? 'SCANNING NBA PRICES' : evError() ? 'QUOTE FEED UNAVAILABLE' : 'MODEL SCAN ACTIVE' }}</span><strong>{{ ev()?.fetchedAt ? dateTime(ev()!.fetchedAt) : 'Waiting for first scan' }}</strong><small>Automatic refresh every 30 min · quotes cached up to 5 min</small></div></div>
      </section>

      <section class="terminal-metrics" aria-label="Market intelligence overview">
        <div class="terminal-metric"><span>POSITIVE MODELED VALUE</span><strong class="highlight-metric">{{ ev()?.offers ? evPositiveCount() : '—' }}</strong><small>Ranked NBA quote sides</small></div>
        <div class="terminal-metric"><span>BEST ESTIMATED ROI</span><strong [class.highlight-metric]="highestModelRoi() !== null">{{ highestModelRoi() === null ? '—' : percent(highestModelRoi()!) }}</strong><small>Net after illustrative fees</small></div>
        <div class="terminal-metric"><span>QUOTES WITH EV ESTIMATES</span><strong>{{ ev()?.offers ? evScoredCount() : '—' }}<small> / {{ ev()?.counts?.comparedOffers ?? '—' }}</small></strong><small>Verified model + match required</small></div>
        <div class="terminal-metric"><span>EXACT NBA EVENTS</span><strong>{{ ev()?.counts?.matchedGames ?? '—' }}</strong><small>Verified contract-to-game matches</small></div>
      </section>

      <div class="terminal-grid">
      <nav class="workspace-tabs" aria-label="Dashboard views" role="tablist">
        <div class="rail-heading">DISCOVER <span>01 / 02</span></div>
        <button type="button" role="tab" id="tab-scanner" aria-controls="panel-scanner" [attr.aria-selected]="activeView() === 'scanner'" [class.active]="activeView() === 'scanner'" (click)="setView('scanner')"><span><b class="nav-glyph">◈</b> EV SCANNER</span><small>Ranked modeled opportunities</small></button>
        <button type="button" role="tab" id="tab-research" aria-controls="panel-research" [attr.aria-selected]="activeView() === 'research'" [class.active]="activeView() === 'research'" [disabled]="!selectedEv()" (click)="setView('research')"><span><b class="nav-glyph">◎</b> MATCHUP DESK</span><small>Selected event analysis</small></button>
        <div class="rail-note"><span>MODEL COVERAGE</span><strong>NBA game winners</strong><p>Only quotes with an independent, game-specific probability and estimated fees receive an EV score. Other Kalshi markets remain internal discovery data.</p></div>
      </nav>
      <div class="terminal-main">

      <div *ngIf="activeView() === 'research'" id="panel-research" role="tabpanel" aria-labelledby="tab-research">
      <section class="radar-panel nba-panel" aria-label="NBA matchup comparisons">
        <div class="panel-heading">
          <div>
            <div class="section-kicker">02 / DEEP DIVE • SELECTED CONTRACT</div>
            <h2>{{ selectedEv()!.away }} <span class="research-versus">vs</span> {{ selectedEv()!.home }}</h2>
            <p>Independent stats for the game you selected. Season form, head-to-head, injury reports and experimental Elo.</p>
          </div>
          <div class="nba-panel-actions"><button class="catalog-nba-shortcut" type="button" (click)="setView('scanner')">← BACK TO EV SCANNER</button><span class="panel-pill nba-pill">GAME-SPECIFIC RESEARCH</span></div>
        </div>
        <p *ngIf="selectedComparisonLoading()" class="nba-state">Retrieving the selected game's ESPN matchup, injuries and model data…</p>
        <div *ngIf="selectedComparisonError()" class="nba-warning" role="alert">Matchup research: {{ selectedComparisonError() }}. The Kalshi quote remains available in the scanner.</div>
        <ng-container *ngIf="nba() as data">
          <div class="nba-feed-meta">ESPN public basketball feeds · Last fetched {{ dateTime(data.fetchedAt) }} · {{ data.season - 1 }}–{{ data.season.toString().slice(-2) }} season</div>
          <div *ngFor="let warning of data.warnings" class="nba-warning">{{ warning }}</div>
          <ng-container *ngIf="data.model as model">
            <details class="model-method-details"><summary>MODEL VALIDATION &amp; COVERAGE <span>VIEW METHODOLOGY ↓</span></summary>
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
            </details>
          </ng-container>
          <div *ngIf="!selectedNbaComparison() && !selectedComparisonLoading() && !selectedComparisonError()" class="empty-state">Select an EV opportunity to load this exact event's matchup data.</div>

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
          <div class="nba-footnote">ESPN-reported statistics and injuries may lag official updates. Elo provides an independent *experimental* estimate; it is not a calibrated sportsbook line, verified lineup forecast or demonstrated betting edge. ESPN's public JSON feeds are subject to change.</div>
        </ng-container>
      </section>
      </div>

      <section class="radar-panel ev-panel" *ngIf="activeView() === 'scanner'" id="panel-scanner" role="tabpanel" aria-labelledby="tab-scanner" aria-label="NBA model versus Kalshi value comparison">
        <div class="feed-titlebar"><div><div class="section-kicker">01 / RANKED VALUE OPPORTUNITIES</div><h2>Start with the numbers.</h2><p>NBA game-winner contracts ranked by estimated value. Select a row to investigate that exact quote.</p></div><span class="feed-badge"><span class="live-dot"></span> INDEPENDENT ELO × KALSHI</span></div>
        <div class="scanner-scope"><span class="scan-scope-dot"></span><strong>SCORING: NBA GAME WINNERS</strong><span>Full Kalshi sports indexing continues in the background. Other contract types receive no EV score until an independent model supports them.</span></div>
        <div class="opportunity-filters">
          <label class="filter-field filter-search">FIND A TEAM<input type="search" [value]="evSearch()" (input)="setEvSearch($any($event.target).value)" placeholder="Search teams or contracts…" aria-label="Search NBA opportunity feed" /></label>
          <label class="filter-field">SORT BY<select [value]="evSort()" (change)="setEvSort($any($event.target).value)" aria-label="Sort opportunities"><option value="edge">HIGHEST MODEL EV</option><option value="roi">HIGHEST MODEL ROI</option><option value="start">SOONEST GAME</option></select></label>
          <label class="filter-field">MINIMUM MODEL EV<select [value]="evMinEdge()" (change)="setEvMinEdge($any($event.target).value)" [disabled]="!evOnlyPositive()" aria-label="Minimum modeled edge per contract"><option value="0">ANY POSITIVE</option><option value="1">+1¢ / CONTRACT</option><option value="2">+2¢ / CONTRACT</option><option value="5">+5¢ / CONTRACT</option></select></label>
          <label class="filter-checkbox"><input type="checkbox" [checked]="evOnlyPositive()" (change)="setPositiveOnly($any($event.target).checked)" /><span>POSITIVE ONLY</span></label>
        </div>
        <p class="nba-state" *ngIf="evLoading() && !ev()">Comparing NBA forecasts with current Kalshi prices…</p>
        <p *ngIf="evError()" class="nba-warning" role="alert">Kalshi NBA EV feed: {{ evError() }} <span *ngIf="ev()">Previously loaded quotes are retained with their original timestamp.</span></p>
        <ng-container *ngIf="ev() as data">
          <div class="feed-meta"><span><strong>{{ evRows().length }}</strong> RANKED QUOTES · {{ data.counts.comparedOffers }} EXAMINED · {{ data.counts.matchedGames }} EVENTS MATCHED</span><span>LAST SCAN {{ dateTime(data.fetchedAt) }}</span></div>
          <div *ngFor="let warning of data.warnings" class="ev-warning">{{ warning }}</div>
          <div *ngIf="!data.model.available" class="ev-warning">Current Elo ratings could not be verified. Model estimates are withheld.</div>
          <div class="scanner-layout">
            <div class="opportunity-feed">
              <div class="opportunity-feed-label"><span>VALUE LEADERBOARD</span><small>SELECT TO INSPECT ↘</small></div>
              <button type="button" class="opportunity-row" *ngFor="let row of visibleEvRows(); index as i; trackBy: trackEvOffer" (click)="chooseEv(row)" [class.is-selected]="isSelectedEv(row)" [attr.aria-label]="'Inspect ' + row.team + ' at ' + cents(row.ask)">
                <span class="row-rank">{{ (i + 1).toString().padStart(2, '0') }}</span>
                <span class="row-matchup"><small>NBA · {{ dateTime(row.startTime) }}</small><strong>{{ row.team }}</strong><span>{{ row.away }} @ {{ row.home }}</span><em>{{ row.side }} route · {{ cents(row.ask) }} ask</em></span>
                <span class="row-edge"><small>EST. NET ROI</small><strong [class.ev-positive]="(row.illustrativeNetEv ?? 0) > 0" [class.ev-negative]="(row.illustrativeNetEv ?? 0) <= 0">{{ modelRoiLabel(row) }}</strong><em>{{ signedCents(row.illustrativeNetEv) }} / contract</em></span>
              </button>
              <div class="opportunity-empty" *ngIf="!evRows().length"><strong>No matches for these filters</strong><p>{{ evOnlyPositive() ? 'No positive model estimates cleared the selected threshold. Lower the filter or inspect all quotes.' : 'No exact NBA comparisons match your search.' }}</p><button type="button" class="history-button" (click)="setPositiveOnly(false)">VIEW ALL COMPARISONS</button></div>
              <div class="list-progress" *ngIf="evRows().length > visibleEvRows().length"><span>{{ visibleEvRows().length }} / {{ evRows().length }} shown</span><button type="button" class="history-button" (click)="showMoreEv()">LOAD MORE ↓</button></div>
            </div>
            <aside class="opportunity-inspector" id="selected-quote" aria-label="Selected quote analysis">
              <ng-container *ngIf="selectedEv() as row; else emptyInspector">
                <div class="inspector-topline"><span>SELECTED OPPORTUNITY</span><span><span class="source-pulse"></span> KALSHI QUOTE</span></div>
                <div class="inspector-matchup"><small>{{ dateTime(row.startTime) }} · NBA / GAME WINNER</small><h3>{{ row.team }}</h3><span>{{ row.away }} @ {{ row.home }} · {{ row.side }} contract</span></div>
                <div class="inspector-edge"><span>MODELED NET ROI • AFTER ESTIMATED FEES</span><strong [class.ev-positive]="(row.illustrativeNetEv ?? 0) > 0" [class.ev-negative]="(row.illustrativeNetEv ?? 0) <= 0">{{ modelRoiLabel(row) }}</strong><small>{{ signedCents(row.illustrativeNetEv) }} modeled net per contract · not a guaranteed return</small></div>
                <div class="probability-comparison"><div class="comparison-label"><span>ELO WIN PROBABILITY</span><strong>{{ percent(row.modelProbability) }}</strong></div><div class="probability-meter"><span class="elo-fill" [style.width.%]="row.modelProbability * 100"></span></div><div class="comparison-label"><span>PRICE + FEE BREAK-EVEN</span><strong>{{ row.breakEvenProbability === null ? '—' : percent(row.breakEvenProbability) }}</strong></div><div class="probability-meter"><span class="market-fill" [style.width.%]="(row.breakEvenProbability ?? row.ask) * 100"></span></div></div>
                <div class="inspector-facts"><div><span>YES/NO ROUTE</span><strong>{{ row.side }}</strong></div><div><span>ASK PRICE</span><strong>{{ cents(row.ask) }}</strong></div><div><span>GROSS MODEL GAP</span><strong>{{ signedCents(row.grossEdge) }}</strong></div><div><span>EST. FEE / CONTRACT</span><strong>{{ preciseCents(row.feePerContract) }}</strong></div></div>
                <div class="inspector-action-stack"><button type="button" class="compare-event-button" (click)="compareSelectedEvent()">COMPARE {{ row.away }} vs {{ row.home }} <span>→</span></button><a class="inspect-market-link" [href]="'https://kalshi.com/markets/kxnbagame/event/' + row.eventTicker.toLowerCase()" target="_blank" rel="noopener noreferrer">VIEW ORIGINAL KALSHI MARKET <span>↗</span></a></div>
                <details class="stake-planner stake-collapsible"><summary><strong>ILLUSTRATE A {{ dollars(stakeBudget()) }} SCENARIO</strong><span>DETAILS ↓</span></summary><label>BUDGET ($)<input type="number" min="0" max="100000" step="1" [value]="stakeBudget()" (input)="setStakeBudget($any($event.target).value)" aria-label="Illustrative stake budget" /></label><ng-container *ngIf="stakeEstimate() as estimate"><div class="stake-count">{{ estimate.contracts }} contracts · approx. {{ dollars(estimate.cost) }} total cost</div><div class="stake-outcomes"><div><small>IF WIN</small><strong>{{ dollars(estimate.ifWin) }}</strong></div><div><small>IF LOSE</small><strong class="ev-negative">{{ dollars(estimate.ifLose) }}</strong></div></div><div class="stake-expected"><span>MODELED EXPECTED NET*</span><strong>{{ dollars(estimate.modelExpected) }}</strong></div></ng-container><p>Fee estimate scales the 100-contract example and may differ for an actual order size. Not an execution quote or a guaranteed return.</p></details>
                <details class="inspector-method"><summary>HOW THIS ESTIMATE WORKS</summary><p>NBA Elo probability − Kalshi ask − estimated standard taker fee. The model does not adjust for injuries, rest or lineups; positive expected value is not a verified arbitrage. Actual size, fees and available prices can change.</p><small>{{ row.ticker }}</small></details>
              </ng-container>
              <ng-template #emptyInspector><div class="inspector-placeholder"><strong>Choose an opportunity</strong><p>Tap an NBA quote to see its market/model gap, price breakdown, and stake scenario.</p></div></ng-template>
            </aside>
          </div>
          <div class="feed-footnote"><span>MODEL QUALITY</span> Elo validation Brier {{ data.model.validationBrier.toFixed(3) }} · {{ data.counts.matchedGames }} exact NBA games matched · {{ data.unmatched.length }} unmatched games withheld. All figures are estimates, not guaranteed profit.</div>
        </ng-container>
      </section>


      </div>
      </div>

      <footer class="footer"><div><strong>OPEN SPORTS INTELLIGENCE</strong><span>Find the signal. Inspect the source.</span></div><div>Kalshi public odds only · ESPN NBA data for independent analysis · Experimental Elo comparisons.</div></footer>
    </main>
  </div>
  `
})
export class AppComponent implements OnInit, OnDestroy {
  readonly activeView = signal<'scanner' | 'research'>('scanner');
  readonly ev = signal<NbaEvResponse | null>(null);
  readonly evLoading = signal(false);
  readonly evError = signal<string | null>(null);
  readonly evOnlyPositive = signal(true);
  readonly evLimit = signal(DEFAULT_LIST_SIZE);
  readonly evSearch = signal('');
  readonly evSort = signal<'edge' | 'roi' | 'start'>('edge');
  readonly evMinEdge = signal(0);
  readonly selectedEvKey = signal<string | null>(null);
  readonly stakeBudget = signal(80);
  readonly evPositiveCount = computed(() => this.ev()?.offers.filter((offer) =>
    offer.illustrativeNetEv !== null && offer.illustrativeNetEv > 0).length ?? 0);
  readonly evScoredCount = computed(() => this.ev()?.offers.filter((offer) => offer.illustrativeNetEv !== null).length ?? 0);
  readonly highestModelRoi = computed(() => {
    const values = (this.ev()?.offers ?? []).map((row) => this.modelRoiValue(row)).filter((v): v is number => v !== null && v > 0);
    return values.length ? Math.max(...values) : null;
  });
  readonly evRows = computed(() => {
    const query = this.evSearch().trim().toLowerCase();
    const rows = (this.ev()?.offers ?? []).filter((offer) =>
      (!this.evOnlyPositive() || (offer.illustrativeNetEv !== null && offer.illustrativeNetEv > Math.max(0, this.evMinEdge()) / 100)) &&
      (!query || [offer.team, offer.home, offer.away, offer.ticker].some((value) => value.toLowerCase().includes(query))));
    if (this.evSort() === 'start') rows.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
    else if (this.evSort() === 'roi') rows.sort((a, b) => (this.modelRoiValue(b) ?? -Infinity) - (this.modelRoiValue(a) ?? -Infinity));
    else rows.sort((a, b) => (b.illustrativeNetEv ?? -Infinity) - (a.illustrativeNetEv ?? -Infinity));
    return rows;
  });
  readonly visibleEvRows = computed(() => this.evRows().slice(0, this.evLimit()));
  readonly selectedEv = computed(() => this.evRows().find((offer) => this.evKey(offer) === this.selectedEvKey()) ?? this.evRows()[0] ?? null);
  readonly stakeEstimate = computed(() => {
    const offer = this.selectedEv();
    return offer ? estimateModelStake(offer.ask, offer.feePerContract, offer.illustrativeNetEv, this.stakeBudget()) : null;
  });
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
  readonly selectedNbaComparison = signal<NbaComparison | null>(null);
  readonly selectedComparisonLoading = signal(false);
  readonly selectedComparisonError = signal<string | null>(null);
  readonly visibleNbaGames = computed(() => this.selectedNbaComparison() ? [this.selectedNbaComparison()!] : []);
  readonly nbaLoading = signal(false);
  readonly nbaError = signal<string | null>(null);
  readonly snapshot = signal<RadarResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly games = computed(() => this.snapshot()?.markets.filter((m) => m.kind === 'game') ?? []);
  readonly championships = computed(() => this.snapshot()?.markets.filter((m) => m.kind === 'championship') ?? []);
  readonly others = computed(() => this.snapshot()?.markets.filter((m) => m.kind === 'other') ?? []);
  readonly selectedMarket = signal<RadarMarket | null>(null);
  readonly selectedPairMarket = signal<RadarMarket | null>(null);
  readonly pairQuantity = signal(100);
  readonly pairMath = computed(() => {
    const market = this.selectedPairMarket();
    return market ? calculatePairQuote(market.yesAsk, market.noAsk, this.pairQuantity()) : null;
  });
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
  private comparisonRequestId = 0;
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
    this.comparisonRequestId++;
    this.evRequestId++;
    this.catalogRequestId++;
  }

  setView(view: 'scanner' | 'research'): void {
    if (view === 'research') { void this.compareSelectedEvent(); return; }
    this.activeView.set(view);
  }

  setPositiveOnly(positive: boolean): void {
    this.evOnlyPositive.set(positive);
    this.evLimit.set(DEFAULT_LIST_SIZE);
  }

  setEvSearch(query: string): void { this.evSearch.set(query); this.evLimit.set(DEFAULT_LIST_SIZE); }

  setEvSort(sort: string): void {
    if (sort === 'edge' || sort === 'roi' || sort === 'start') this.evSort.set(sort);
  }

  setEvMinEdge(value: string): void {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) this.evMinEdge.set(parsed);
  }

  setStakeBudget(value: string): void {
    const parsed = Number(value);
    this.stakeBudget.set(Number.isFinite(parsed) ? Math.min(100000, Math.max(0, parsed)) : 0);
  }

  evKey(row: NbaEvResponse['offers'][number]): string { return `${row.ticker}:${row.outcome}`; }
  chooseEv(row: NbaEvResponse['offers'][number]): void {
    if (this.evKey(row) !== this.selectedEvKey()) {
      this.comparisonRequestId++;
      this.selectedNbaComparison.set(null);
      this.selectedComparisonError.set(null);
      this.selectedComparisonLoading.set(false);
      this.selectedEvKey.set(this.evKey(row));
    }
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 850px)').matches) {
      requestAnimationFrame(() => document.getElementById('selected-quote')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  isSelectedEv(row: NbaEvResponse['offers'][number]): boolean {
    return this.selectedEv() !== null && this.evKey(this.selectedEv()!) === this.evKey(row);
  }

  modelRoiValue(row: NbaEvResponse['offers'][number]): number | null {
    return modeledRoi(row.ask, row.feePerContract, row.illustrativeNetEv);
  }

  modelRoiLabel(row: NbaEvResponse['offers'][number]): string {
    const value = this.modelRoiValue(row);
    return value === null ? '—' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
  }

  dollars(value: number): string {
    return Number.isFinite(value) ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '—';
  }

  showMoreEv(): void { this.evLimit.update((limit) => limit + DEFAULT_LIST_SIZE); }
  showMoreCatalog(): void { this.catalogLimit.update((limit) => limit + DEFAULT_LIST_SIZE); }

  async compareSelectedEvent(): Promise<void> {
    const quote = this.selectedEv();
    if (!quote) return;
    this.activeView.set('research');
    if (this.selectedNbaComparison()?.gameId === quote.gameId) return;
    const requestId = ++this.comparisonRequestId;
    this.selectedNbaComparison.set(null);
    this.selectedComparisonError.set(null);
    this.selectedComparisonLoading.set(true);
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date(quote.startTime));
      const value = (part: string) => parts.find((item) => item.type === part)?.value ?? '';
      const date = `${value('year')}-${value('month')}-${value('day')}`;
      const params = new URLSearchParams({ gameId: quote.gameId, date });
      const response = await fetch(`/api/nba/comparisons?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Matchup feed returned HTTP ${response.status}.`);
      const data: NbaComparisonResponse = await response.json();
      if (!Array.isArray(data?.games)) throw new Error('Unexpected matchup comparison response.');
      if (requestId !== this.comparisonRequestId) return;
      const game = data.games.find((entry) => entry.gameId === quote.gameId);
      if (!game) throw new Error('This event is not yet available in the independent matchup feed.');
      this.nba.set(data);
      this.selectedNbaComparison.set(game);
    } catch (error) {
      if (requestId === this.comparisonRequestId) this.selectedComparisonError.set(error instanceof Error ? error.message : 'Matchup research unavailable.');
    } finally {
      if (requestId === this.comparisonRequestId) this.selectedComparisonLoading.set(false);
    }
  }

  setCatalogQuery(query: string): void {
    this.catalogQuery.set(query);
    this.catalogLimit.set(DEFAULT_LIST_SIZE);
  }

  setCatalogKind(kind: string): void {
    if (kind !== 'ALL' && kind !== 'game' && kind !== 'championship' && kind !== 'other') return;
    this.catalogKind.set(kind);
    this.catalogLimit.set(DEFAULT_LIST_SIZE);
  }

  inspectPair(market: RadarMarket): void {
    this.selectedPairMarket.set(market);
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => document.getElementById('pair-checker')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  closePair(): void { this.selectedPairMarket.set(null); }

  setPairQuantity(value: string): void {
    const count = Number(value);
    this.pairQuantity.set(Number.isFinite(count) ? Math.min(10000, Math.max(1, Math.floor(count))) : 1);
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
    await this.refreshEv(force);
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
