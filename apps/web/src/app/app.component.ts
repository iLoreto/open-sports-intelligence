import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import type { RadarMarket, RadarResponse } from './market.model';

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
        <div class="eyebrow"><span class="eyebrow-line"></span> THE INTELLIGENCE TERMINAL <span class="version-tag">V0.1 / MARKET DATA</span></div>
        <h1>See the market.<br><span>Question the price.</span></h1>
        <p class="hero-copy">An open, independent view of sports prediction markets. Track the actual quoted prices, movement and liquidity before making your own assessment.</p>
        <div class="hero-actions">
          <span class="source-state"><span class="source-pulse"></span> {{ loading() ? 'SCANNING PUBLIC FEED' : error() ? 'FEED UNAVAILABLE' : 'KALSHI FEED CONNECTED' }}</span>
          <button class="refresh-button" type="button" (click)="refresh(true)" [disabled]="loading()" [attr.aria-busy]="loading()">
            <span aria-hidden="true" class="refresh-icon" [class.spinning]="loading()">↻</span>
            {{ loading() ? 'SCANNING' : 'REFRESH DATA' }}
          </button>
        </div>
      </section>

      <section class="stat-strip" aria-label="Radar overview">
        <div class="stat-item"><span class="stat-label">MARKETS IN VIEW</span><strong>{{ snapshot()?.counts?.returnedMarkets ?? '—' }}</strong><small>Selected sports series</small></div>
        <div class="stat-item"><span class="stat-label">SERIES CHECKED</span><strong>{{ snapshot()?.counts?.scannedSeries ?? '—' }}</strong><small>Kalshi catalog</small></div>
        <div class="stat-item"><span class="stat-label">DATA UPDATED</span><strong class="time-stat">{{ timeLabel() }}</strong><small>Automatic 30-minute refresh</small></div>
        <div class="stat-item"><span class="stat-label">MODEL STATUS</span><strong class="model-stat">RESEARCH</strong><small>No unverified edge scores</small></div>
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
        <div *ngIf="data.counts.partialCoverage" class="coverage-note"><span class="coverage-dash"></span> Initial scan covers a selected subset of sports series. Full-catalog historical collection is the next engineering milestone.</div>

        <section class="radar-panel">
          <div class="panel-heading">
            <div><div class="section-kicker">01 / EVENT WINDOW</div><h2>Upcoming games <span class="heading-count">{{ games().length }}</span></h2><p>Open sports contracts associated with games in the next 24 hours.</p></div>
            <span class="panel-pill">ROLLING 24H</span>
          </div>
          <ng-container *ngTemplateOutlet="marketsTable; context: { rows: games(), empty: 'No upcoming game markets returned in this scan.' }"></ng-container>
        </section>

        <section class="radar-panel championships-panel">
          <div class="panel-heading">
            <div><div class="section-kicker">02 / FUTURES DESK</div><h2>Championship watch <span class="heading-count">{{ championships().length }}</span></h2><p>Season-long and title markets are tracked separately from single games.</p></div>
            <span class="panel-pill purple">FUTURES</span>
          </div>
          <ng-container *ngTemplateOutlet="marketsTable; context: { rows: championships(), empty: 'No championship markets returned in this scan.' }"></ng-container>
        </section>

        <section class="radar-panel other-panel" *ngIf="others().length">
          <div class="panel-heading">
            <div><div class="section-kicker">03 / ADDITIONAL COVERAGE</div><h2>Other sports contracts <span class="heading-count">{{ others().length }}</span></h2><p>Sports markets not yet classified as upcoming games or championships.</p></div>
          </div>
          <ng-container *ngTemplateOutlet="marketsTable; context: { rows: others(), empty: '' }"></ng-container>
        </section>
      </ng-container>

      <ng-template #marketsTable let-rows="rows" let-empty="empty">
        <div *ngIf="!rows.length" class="empty-state">{{ empty }}</div>
        <div class="table-wrap" *ngIf="rows.length">
          <table>
            <thead><tr><th>SPORT / MARKET</th><th class="numeric">YES BID</th><th class="numeric">YES ASK</th><th class="numeric">CHANGE*</th><th class="numeric">24H VOL.</th><th class="numeric">SPREAD</th></tr></thead>
            <tbody>
              <tr *ngFor="let row of rows; trackBy: trackTicker">
                <td class="market-identity"><div class="identity-top"><span class="sport-chip">{{ row.sport }}</span><span class="market-ticker">{{ row.ticker }}</span></div><div class="market-title">{{ row.title }}</div><div class="event-title">{{ row.eventTitle }}</div></td>
                <td class="numeric price-muted">{{ cents(row.yesBid) }}</td>
                <td class="numeric main-price">{{ cents(row.yesAsk) }}</td>
                <td class="numeric"><span class="movement" [class.positive]="(row.priceChange ?? 0) > 0" [class.negative]="(row.priceChange ?? 0) < 0">{{ changeLabel(row.priceChange) }}</span></td>
                <td class="numeric">{{ volume(row.volume24h) }}</td>
                <td class="numeric price-muted">{{ spread(row) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </ng-template>

      <footer class="footer"><div><strong>OPEN SPORTS INTELLIGENCE</strong><span>Independent by design. Transparent by default.</span></div><div>Source: Kalshi public API · Market data may be delayed · No model forecasts published yet.</div></footer>
    </main>
  </div>
  `
})
export class AppComponent implements OnInit, OnDestroy {
  readonly snapshot = signal<RadarResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly games = computed(() => this.snapshot()?.markets.filter((m) => m.kind === 'game') ?? []);
  readonly championships = computed(() => this.snapshot()?.markets.filter((m) => m.kind === 'championship') ?? []);
  readonly others = computed(() => this.snapshot()?.markets.filter((m) => m.kind === 'other') ?? []);
  private timer: ReturnType<typeof setInterval> | undefined;

  ngOnInit(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(force = false): Promise<void> {
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
