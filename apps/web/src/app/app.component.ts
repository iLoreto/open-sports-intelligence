import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { BUILD_ID } from './build-info';
type Sport = 'nba' | 'nfl' | 'nhl' | 'mlb' | 'wnba' | 'ncaaf' | 'ncaam' | 'tennis';
type ScanLeague = Exclude<Sport, 'tennis'>;
interface Team { id: number | string; full_name: string; abbreviation?: string }
interface Stats { games: number; wins: number; losses: number; ties?: number; pointsFor: number | null; pointsAgainst: number | null; recent: { date: string; scored: number; allowed: number; win: boolean }[] }
interface NhlXgTeam { abbreviation: string; games: number; xgShare: number; xgf60: number; xga60: number; xgd60: number; highDangerFor: number; highDangerAgainst: number }
interface NhlXgComparison { source: string; fetchedAt: string; season: number; left: NhlXgTeam; right: NhlXgTeam; note: string; attribution: string }
interface Market { ticker: string; event: string; title: string; side: 'YES' | 'NO'; askCents: number; yesBid: string | null; yesAsk: string | null; noAsk: string | null; last: string | null; volume24h: string | null }
interface ScanResult { source: string; scannedAt: string; markets: Market[]; partialCoverage: boolean; note: string; pagesScanned: number; sportsEvents: number }
interface Comparison { source: string; fetchedAt: string; sample: number; left: Stats; right: Stats; partial: boolean; note: string; h2h?: { games: number; leftWins: number; rightWins: number; ties: number; meetings: { date: string; leftScore: number; rightScore: number }[] }; metricProfile?: { unit: string; available: string[]; unavailable: string[] } }
@Component({
  selector: 'osi-root', standalone: true, imports: [CommonModule],
  template: `
  <main class="workbench">
    <header><div class="eyebrow">OPEN SPORTS INTELLIGENCE</div><h1>Sports Research Workbench</h1><p>Manual, sport-specific research. No automated scanning.</p></header>
    <nav class="sports" aria-label="Workspaces"><button [class.selected]="tab() === 'research'" (click)="chooseTab('research')">Research</button><button [class.selected]="tab() === 'markets'" (click)="chooseTab('markets')">Market Scanner</button><a class="methodology-nav" href="/how-we-read-the-game.html" aria-label="Read Radar Methodology and discipline rules">Radar Methodology</a><button type="button" class="methodology-nav" (click)="openLiveMonitor()" aria-label="Open password-protected Live Monitor">📊 Live Monitor</button></nav>
    <nav class="sports" aria-label="Sports"><button *ngFor="let league of availableLeagues" [class.selected]="sport() === league.id" (click)="chooseSport(league.id)"><svg *ngIf="league.id === 'tennis'" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" style="vertical-align:-3px;margin-right:5px"><circle cx="12" cy="12" r="10" fill="#c6e948" stroke="#75962b" stroke-width="1"/><path d="M5.2 4.6C11 8 11 16 5.2 19.4M18.8 4.6C13 8 13 16 18.8 19.4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>{{ league.label }}</button></nav>
    <ng-container *ngIf="tab() === 'research'">
    <section class="panel" *ngIf="sport() !== 'tennis'">
      <div class="eyebrow">{{ sport().toUpperCase() }} / TEAM COMPARISON</div><h2>Team vs team</h2>
      <p>Select two teams and a historical sample. The comparison calculates completed-game win/loss and scoring averages.</p>
      <div class="columns">
        <label>Team A<select [value]="left()" (change)="left.set($any($event.target).value)"><option [value]="0">Select team</option><option *ngFor="let team of teams()" [value]="team.id">{{ team.full_name }}</option></select></label>
        <label>Team B<select [value]="right()" (change)="right.set($any($event.target).value)"><option [value]="0">Select team</option><option *ngFor="let team of teams()" [value]="team.id">{{ team.full_name }}</option></select></label>
      </div>
      <label>Completed games to compare<select [value]="sample()" (change)="sample.set(+$any($event.target).value)"><option [value]="5">Last 5</option><option [value]="10">Last 10</option><option [value]="20">Last 20</option></select></label>
      <button class="run" [disabled]="loading() || !left() || !right() || left() === right()" (click)="run()">{{ loading() ? 'Loading…' : 'Run comparison →' }}</button>
      <p *ngIf="teamLoading()" class="hint">Loading {{ sport().toUpperCase() }} teams…</p><p class="hint">Historical results from ESPN; NHL also includes season-to-date five-on-five xG from MoneyPuck. Injury, goalie, and market information are not included.</p>
    </section>
    <section class="panel" *ngIf="sport() === 'tennis'"><div class="eyebrow">TENNIS / ATP · WTA · CHALLENGER</div><h2>Tennis research</h2><p>The tennis provider is not yet configured. Player comparison controls will be enabled after verifying tournament coverage and historical statistics.</p></section>
    <section class="panel" *ngIf="sport() !== 'tennis'" aria-live="polite"><h2>Results</h2>
      <p *ngIf="error()" class="error">{{ error() }}</p><p *ngIf="loading()">Retrieving provider data…</p>
      <p *ngIf="!loading() && !comparison() && !error()" class="hint">Choose two teams and run a comparison.</p>
      <ng-container *ngIf="comparison() as c"><p class="meta">{{ c.source }} · {{ c.fetchedAt | date:'medium' }} · Last {{ c.sample }} games requested</p>
        <div class="columns">
          <div class="stats"><h3>{{ teamName(left()) }}</h3><p>{{ c.left.wins }}W–{{ c.left.losses }}L<span *ngIf="c.left.ties">–{{ c.left.ties }}T</span> ({{ c.left.games }} games)</p><p>{{ c.metricProfile?.unit || 'Points' }} scored: {{ c.left.pointsFor ?? '—' }} / game</p><p>{{ c.metricProfile?.unit || 'Points' }} allowed: {{ c.left.pointsAgainst ?? '—' }} / game</p><p *ngFor="let g of c.left.recent">{{ g.date | date:'shortDate' }} · {{ g.scored }}–{{ g.allowed }} · {{ g.win ? 'W' : 'L' }}</p></div>
          <div class="stats"><h3>{{ teamName(right()) }}</h3><p>{{ c.right.wins }}W–{{ c.right.losses }}L<span *ngIf="c.right.ties">–{{ c.right.ties }}T</span> ({{ c.right.games }} games)</p><p>{{ c.metricProfile?.unit || 'Points' }} scored: {{ c.right.pointsFor ?? '—' }} / game</p><p>{{ c.metricProfile?.unit || 'Points' }} allowed: {{ c.right.pointsAgainst ?? '—' }} / game</p><p *ngFor="let g of c.right.recent">{{ g.date | date:'shortDate' }} · {{ g.scored }}–{{ g.allowed }} · {{ g.win ? 'W' : 'L' }}</p></div>
        </div>
        <div class="stats" *ngIf="sport() === 'nhl' && nhlXg() as xg">
          <h3>Five-on-five expected goals · MoneyPuck</h3>
          <p class="meta">{{ xg.attribution }} · {{ xg.fetchedAt | date:'medium' }} · {{ xg.season }}–{{ xg.season + 1 }} season</p>
          <div class="columns">
            <div><strong>{{ teamName(left()) }}</strong><p>xG share: {{ xg.left.xgShare * 100 | number:'1.1-1' }}%</p><p>xGF/60: {{ xg.left.xgf60 | number:'1.2-2' }} · xGA/60: {{ xg.left.xga60 | number:'1.2-2' }}</p><p>xG differential/60: {{ xg.left.xgd60 | number:'1.2-2' }}</p><p>High-danger shots: {{ xg.left.highDangerFor }} for / {{ xg.left.highDangerAgainst }} against</p></div>
            <div><strong>{{ teamName(right()) }}</strong><p>xG share: {{ xg.right.xgShare * 100 | number:'1.1-1' }}%</p><p>xGF/60: {{ xg.right.xgf60 | number:'1.2-2' }} · xGA/60: {{ xg.right.xga60 | number:'1.2-2' }}</p><p>xG differential/60: {{ xg.right.xgd60 | number:'1.2-2' }}</p><p>High-danger shots: {{ xg.right.highDangerFor }} for / {{ xg.right.highDangerAgainst }} against</p></div>
          </div><p class="hint">{{ xg.note }}</p>
        </div>
        <p *ngIf="sport() === 'nhl' && nhlXgError()" class="error">MoneyPuck xG unavailable: {{ nhlXgError() }}</p>
        <div class="stats" *ngIf="c.h2h as h"><h3>Direct head-to-head</h3><p>{{ h.games }} verified meetings in retrieved history · {{ teamName(left()) }}: {{ h.leftWins }} wins · {{ teamName(right()) }}: {{ h.rightWins }} wins · {{ h.ties }} ties</p><p *ngFor="let g of h.meetings">{{ g.date | date:'shortDate' }} · {{ g.leftScore }}–{{ g.rightScore }}</p><p *ngIf="!h.games">No direct meetings found in the retrieved window.</p></div><p class="hint" *ngIf="c.metricProfile">Advanced {{ sport().toUpperCase() }} metrics not yet available: {{ c.metricProfile.unavailable.join(', ') }}.</p><p class="hint">{{ c.note }} <strong *ngIf="c.partial">Provider pagination indicates incomplete coverage.</strong></p>
      </ng-container>
    </section></ng-container>
    <section class="panel" *ngIf="tab() === 'markets'"><div class="eyebrow">MANUAL MARKET RESEARCH</div><h2>Market Scanner</h2><p>Select a provider and ask range, then press Scan to retrieve a new market snapshot for the selected league. No scheduled scans or automatic refresh.</p>
      <div class="sports"><button [class.selected]="provider() === 'kalshi'" (click)="chooseProvider('kalshi')">Kalshi</button><button [class.selected]="provider() === 'novig'" (click)="chooseProvider('novig')">Novig</button></div>
      <div class="range-header"><strong>Ask price range</strong><strong>{{ minPrice() }}¢ – {{ maxPrice() }}¢</strong></div>
      <div class="range-control" role="group" aria-label="Contract price range">
        <div class="range-values"><label for="min-ask">Minimum: {{ minPrice() }}¢</label><label for="max-ask">Maximum: {{ maxPrice() }}¢</label></div>
        <div class="dual-range" [style.--range-start.%]="(minPrice() - 1) / 98 * 100" [style.--range-end.%]="(maxPrice() - 1) / 98 * 100">
          <div class="dual-range-track"></div>
          <input id="min-ask" aria-label="Minimum ask price" type="range" min="1" max="99" step="1" [value]="minPrice()" (input)="setMinPrice(+$any($event.target).value)" />
          <input id="max-ask" aria-label="Maximum ask price" type="range" min="1" max="99" step="1" [value]="maxPrice()" (input)="setMaxPrice(+$any($event.target).value)" />
        </div>
        <div class="range-scale"><span>1¢</span><span>99¢</span></div>
      </div>
      <p class="hint">Sports moneyline match markets only. Matches either YES or NO contracts whose current ask is within the inclusive range.</p>
      <p *ngIf="!validPriceRange()" class="error">Enter a valid range between 1¢ and 99¢, with minimum ≤ maximum.</p>
      <p *ngIf="provider() === 'novig'" class="hint">Novig integration is not configured yet.</p>
      <button class="run" [disabled]="scanLoading() || provider() === 'novig' || !validPriceRange()" (click)="scan()">{{ scanLoading() ? 'Scanning…' : 'Scan now →' }}</button>
      <p *ngIf="scanError()" class="error">{{ scanError() }}</p>
      <ng-container *ngIf="scanResult() as result"><p class="meta">{{ result.source }} · {{ result.scannedAt | date:'medium' }} · {{ result.markets.length }} matching contracts · {{ result.sportsEvents }} sports events across {{ result.pagesScanned }} pages</p><p *ngIf="result.markets.length === 0" class="error">No matching contracts in the scanned portion. {{ result.partialCoverage ? 'Coverage is incomplete; this is NOT a full-book no-match result.' : 'Try widening the price range.' }}</p><p class="hint">{{ result.note }} <strong *ngIf="result.partialCoverage">More pages exist; this snapshot is incomplete.</strong></p>
        <a *ngFor="let m of result.markets" class="stats market-result" [href]="marketUrl(m)" target="_blank" rel="noopener noreferrer" [attr.aria-label]="'Open Kalshi market ' + m.title"><div class="market-result-heading"><strong>{{ m.event }} ↗</strong><span class="market-percentage" [attr.aria-label]="m.side + ' ask price ' + m.askCents + ' percent'">{{ m.askCents }}%</span></div><p>{{ m.title }} · {{ m.ticker }} · {{ m.side }} ask {{ m.askCents }}¢</p><p>YES bid {{ m.yesBid ?? '—' }} · YES ask {{ m.yesAsk ?? '—' }} · NO ask {{ m.noAsk ?? '—' }} · Last {{ m.last ?? '—' }} · 24h volume {{ m.volume24h ?? '—' }}</p></a>
      </ng-container>
    </section>
    <footer class="build-footer" aria-label="Application build version">Build {{ buildId }}</footer>
  </main>`,
  styles: [`
    .methodology-nav{display:inline-flex;align-items:center;justify-content:center;padding:10px 16px;border:1px solid #70b8da;border-radius:9px;color:#c7edff;background:#15304a;font-weight:700;text-decoration:none;min-height:42px;white-space:nowrap}.methodology-nav:hover,.methodology-nav:focus-visible{background:#225272;color:#fff;outline-offset:3px}
    .build-footer{margin:1.5rem auto 0;text-align:center;font:600 12px/1.5 monospace;letter-spacing:.04em;color:#9aa9ba;opacity:.95;}
    :host{display:block;min-height:100vh;background:#0b1220;color:#e7edf7;font:16px system-ui,sans-serif}
    .workbench{max-width:960px;margin:auto;padding:40px 20px 80px}header{margin-bottom:28px}h1{font-size:clamp(2rem,5vw,3.4rem);letter-spacing:-.04em;margin:10px 0}h2{margin:0 0 20px}h3{margin:0}
    p{color:#a9b7cc;line-height:1.55}.eyebrow{font-size:12px;font-weight:800;letter-spacing:.17em;color:#73d8d0}.sports{display:flex;gap:12px;margin-bottom:22px;flex-wrap:wrap}.sports button{min-width:100px}.sports button{flex:1}
    button,select,input{font:inherit;border:1px solid #354359;border-radius:10px;padding:12px 14px;background:#18263a;color:#f5f8fd}input{width:100%;box-sizing:border-box;margin-top:8px}button{cursor:pointer}button.selected{border-color:#69d8d0;background:#123b45}button:disabled{opacity:.55;cursor:default}
    .panel{background:#111d2d;border:1px solid #29394e;border-radius:16px;padding:24px;margin-bottom:18px}label{display:block;margin:16px 0 7px;font-size:13px;color:#c3d0df}select{display:block;width:100%;box-sizing:border-box;margin-top:8px}
    .columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.run{width:100%;background:#69d8d0;color:#08242c;border:0;font-weight:800;margin-top:22px}.hint,.meta{font-size:13px}.error{color:#ffaaa6}.stats{padding:15px;background:#172538;border-radius:10px}
    .range-header{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:22px}
    .range-header strong:last-child{font-size:clamp(1.55rem,3.2vw,2.2rem);line-height:1.05;font-weight:900;letter-spacing:.01em;color:#a2eee7;text-shadow:0 0 16px rgba(105,216,208,.25)}
    .range-control{padding:14px 18px;background:#172538;border:1px solid #354359;border-radius:12px;margin-top:12px}
    .range-values,.range-scale{display:flex;justify-content:space-between;gap:12px}
    .range-values label{margin:0 0 12px;font-size:13px}
    .range-scale{font-size:12px;color:#a9b7cc;margin-top:9px}
    .dual-range{position:relative;height:32px;display:flex;align-items:center}
    .dual-range-track{height:7px;width:100%;border-radius:999px;background:linear-gradient(to right,#354359 0%,#354359 var(--range-start),#69d8d0 var(--range-start),#69d8d0 var(--range-end),#354359 var(--range-end),#354359 100%)}
    .dual-range input[type=range]{position:absolute;left:0;top:0;width:100%;height:32px;margin:0;padding:0;border:0;background:transparent;appearance:none;-webkit-appearance:none;pointer-events:none;cursor:pointer}
    .dual-range input[type=range]::-webkit-slider-runnable-track{height:7px;background:transparent}
    .dual-range input[type=range]::-moz-range-track{height:7px;background:transparent}
    .dual-range input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:22px;height:22px;border-radius:50%;background:#69d8d0;border:3px solid #0c1728;box-shadow:0 0 0 1px #a2eee7;pointer-events:auto;margin-top:-7.5px}
    .dual-range input[type=range]::-moz-range-thumb{width:17px;height:17px;border-radius:50%;background:#69d8d0;border:3px solid #0c1728;pointer-events:auto}
    .dual-range input[type=range]:focus-visible{outline:2px solid #a2eee7;outline-offset:5px}
    .dual-range input[type=range]:first-of-type{z-index:2}
    .dual-range input[type=range]:last-of-type{z-index:3}
    .market-result{display:block;text-decoration:none;color:inherit;margin-top:10px;border:1px solid #354359;transition:border-color .15s,background .15s}.market-result:hover,.market-result:focus-visible{border-color:#69d8d0;background:#20354a;outline-offset:2px}.market-result strong{color:#85e6dc}
    .market-result-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.market-percentage{font-size:clamp(24px,3vw,34px);line-height:1;font-weight:800;font-variant-numeric:tabular-nums;color:#85e6dc;white-space:nowrap}
    .stats p{font-size:14px;border-bottom:1px solid #29394e;padding-bottom:6px}@media(max-width:650px){.columns{grid-template-columns:1fr}}
  `]
})
export class AppComponent {
  marketUrl(m: Market): string { return 'https://kalshi.com/markets/' + encodeURIComponent(m.ticker.toLowerCase()); }
  readonly tab = signal<'research' | 'markets'>('research');
  readonly provider = signal<'kalshi' | 'novig'>('kalshi');
  readonly minPrice = signal(50); readonly maxPrice = signal(72);
  setMinPrice(value: number): void { if (Number.isInteger(value)) { this.minPrice.set(Math.max(1, Math.min(value, this.maxPrice()))); this.invalidateScan(); } }
  setMaxPrice(value: number): void { if (Number.isInteger(value)) { this.maxPrice.set(Math.min(99, Math.max(value, this.minPrice()))); this.invalidateScan(); } }
  private invalidateScan(): void { this.scanId++; this.scanLoading.set(false); this.scanError.set(''); this.scanResult.set(null); }
  validPriceRange(): boolean { const a = this.minPrice(), b = this.maxPrice(); return Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b <= 99 && a <= b; }
  readonly scanLoading = signal(false); readonly scanError = signal(''); readonly scanResult = signal<ScanResult | null>(null);
  private scanId = 0;
  chooseTab(value: 'research' | 'markets'): void { this.tab.set(value); this.scanId++; this.scanLoading.set(false); this.scanError.set(''); this.scanResult.set(null); }
  chooseProvider(value: 'kalshi' | 'novig'): void { this.provider.set(value); this.scanId++; this.scanLoading.set(false); this.scanError.set(''); this.scanResult.set(null); }
  async scan(): Promise<void> {
    if (this.provider() !== 'kalshi' || this.scanLoading() || !this.validPriceRange()) return;
    const id = ++this.scanId; this.scanLoading.set(true); this.scanError.set(''); this.scanResult.set(null);
    try {
      const response = await fetch('/api/markets/scan?provider=kalshi&league=' + encodeURIComponent(this.scanLeague()) + '&min=' + this.minPrice() + '&max=' + this.maxPrice(), { method: 'POST', cache: 'no-store' });
      const body = await response.json() as ScanResult & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Market scan unavailable');
      if (id === this.scanId && this.tab() === 'markets' && this.provider() === 'kalshi') this.scanResult.set(body);
    } catch(e) { if (id === this.scanId) this.scanError.set(e instanceof Error ? e.message : 'Scan unavailable'); }
    finally { if (id === this.scanId) this.scanLoading.set(false); }
  }
  openLiveMonitor(): void {
    const password = window.prompt('Enter Live Monitor password');
    if (password === null) return;
    if (password !== 'XTBY') { window.alert('Incorrect password.'); return; }
    window.location.assign('/live-monitor.html');
  }
  readonly buildId = BUILD_ID;
  readonly availableLeagues: { id: Sport; label: string }[] = [{id:'nba',label:'🏀 NBA'},{id:'nfl',label:'🏈 NFL'},{id:'nhl',label:'🏒 NHL'},{id:'mlb',label:'⚾ MLB'},{id:'wnba',label:'🏀 WNBA'},{id:'ncaaf',label:'🏈 NCAA Football'},{id:'ncaam',label:'🏀 NCAA Basketball'},{id:'tennis',label:'Tennis'}];
  readonly sport = signal<Sport>('nba');
  readonly scanLeague = signal<ScanLeague>('nba');
  readonly teamLoading = signal(false);
  readonly teams = signal<Team[]>([]);
  readonly left = signal<string | number>(0); readonly right = signal<string | number>(0); readonly sample = signal(10);
  readonly nhlXg = signal<NhlXgComparison | null>(null); readonly nhlXgError = signal('');
  readonly loading = signal(false); readonly comparison = signal<Comparison | null>(null); readonly error = signal('');
  private requestId = 0;
  constructor() { void this.loadTeams(); }
  teamName(id: number | string): string { return this.teams().find(t => String(t.id) === String(id))?.full_name ?? 'Team'; }
  chooseSport(value: Sport): void {
    this.requestId++; this.sport.set(value); this.teams.set([]); this.left.set(0); this.right.set(0); this.loading.set(false); this.comparison.set(null); this.nhlXg.set(null); this.nhlXgError.set(''); this.error.set(''); if (value !== 'tennis') { this.scanLeague.set(value); void this.loadTeams(); }
  }
  async loadTeams(): Promise<void> {
    const selected = this.sport(); if (selected === 'tennis') return; const requestId = this.requestId; this.teamLoading.set(true);
    try {
      const response = await fetch(selected === 'nba' ? '/api/nba/teams' : '/api/leagues/' + selected + '/teams', { cache: 'no-store' });
      const body = await response.json() as { teams?: Team[]; message?: string };
      if (!response.ok) throw new Error(body.message || 'Unable to load NBA teams');
      if (requestId === this.requestId && selected === this.sport()) this.teams.set((body.teams || []).filter(t => t.id && t.full_name).sort((a,b) => a.full_name.localeCompare(b.full_name)));
    } catch(e) { if (requestId === this.requestId && selected === this.sport()) this.error.set(e instanceof Error ? e.message : 'Unable to load teams'); }
    finally { if (requestId === this.requestId) this.teamLoading.set(false); }
  }
  async run(): Promise<void> {
    if (this.sport() === 'tennis' || !this.left() || !this.right() || String(this.left()) === String(this.right())) return;
    const id = ++this.requestId, a = this.left(), b = this.right(), n = this.sample();
    this.loading.set(true); this.error.set(''); this.comparison.set(null); this.nhlXg.set(null); this.nhlXgError.set('');
    try {
      const endpoint = this.sport() === 'nba' ? '/api/nba/compare' : '/api/leagues/' + this.sport() + '/compare';
      const response = await fetch(endpoint + '?left=' + encodeURIComponent(a) + '&right=' + encodeURIComponent(b) + '&sample=' + n, { cache: 'no-store' });
      const body = await response.json() as Comparison & { message?: string; error?: string };
      if (!response.ok) throw new Error(body.message || body.error || 'Comparison unavailable');
      if (id === this.requestId) this.comparison.set(body);
      if (this.sport() === 'nhl' && id === this.requestId) {
        const leftTeam = this.teams().find(t => String(t.id) === String(a));
        const rightTeam = this.teams().find(t => String(t.id) === String(b));
        if (!leftTeam?.abbreviation || !rightTeam?.abbreviation) this.nhlXgError.set('NHL team abbreviations missing from ESPN directory.');
        else {
          try {
            const xgResponse = await fetch('/api/nhl/xg-comparison?left=' + encodeURIComponent(leftTeam.abbreviation) + '&right=' + encodeURIComponent(rightTeam.abbreviation), { cache: 'no-store' });
            const xgBody = await xgResponse.json() as NhlXgComparison & { error?: string };
            if (!xgResponse.ok) throw new Error(xgBody.error || 'MoneyPuck unavailable');
            if (id === this.requestId) this.nhlXg.set(xgBody);
          } catch (e) { if (id === this.requestId) this.nhlXgError.set(e instanceof Error ? e.message : 'MoneyPuck unavailable'); }
        }
      }
    } catch(e) { if (id === this.requestId) this.error.set(e instanceof Error ? e.message : 'Unable to compare teams'); }
    finally { if (id === this.requestId) this.loading.set(false); }
  }
}
