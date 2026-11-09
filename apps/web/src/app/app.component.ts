import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
type Sport = 'nba' | 'tennis';
interface Team { id: number; full_name: string; abbreviation?: string }
interface Stats { games: number; wins: number; losses: number; pointsFor: number | null; pointsAgainst: number | null; recent: { date: string; scored: number; allowed: number; win: boolean }[] }
interface Market { ticker: string; event: string; title: string; yesBid: string | null; yesAsk: string | null; noAsk: string | null; last: string | null; volume24h: string | null }
interface ScanResult { source: string; scannedAt: string; markets: Market[]; partialCoverage: boolean; note: string }
interface Comparison { source: string; fetchedAt: string; sample: number; left: Stats; right: Stats; partial: boolean; note: string }
@Component({
  selector: 'osi-root', standalone: true, imports: [CommonModule],
  template: `
  <main class="workbench">
    <header><div class="eyebrow">OPEN SPORTS INTELLIGENCE</div><h1>Sports Research Workbench</h1><p>Manual, sport-specific research. No automated scanning.</p></header>
    <nav class="sports" aria-label="Workspaces"><button [class.selected]="tab() === 'research'" (click)="chooseTab('research')">Research</button><button [class.selected]="tab() === 'markets'" (click)="chooseTab('markets')">Market Scanner</button></nav>
    <ng-container *ngIf="tab() === 'research'"><nav class="sports" aria-label="Sports"><button [class.selected]="sport() === 'nba'" (click)="chooseSport('nba')">🏀 NBA</button><button [class.selected]="sport() === 'tennis'" (click)="chooseSport('tennis')">🎾 Tennis</button></nav>
    <section class="panel" *ngIf="sport() === 'nba'">
      <div class="eyebrow">BALLDONTLIE / NBA</div><h2>Team vs team</h2>
      <p>Select two teams and a historical sample. The comparison calculates completed-game win/loss and scoring averages.</p>
      <div class="columns">
        <label>Team A<select [value]="left()" (change)="left.set(+$any($event.target).value)"><option [value]="0">Select team</option><option *ngFor="let team of teams()" [value]="team.id">{{ team.full_name }}</option></select></label>
        <label>Team B<select [value]="right()" (change)="right.set(+$any($event.target).value)"><option [value]="0">Select team</option><option *ngFor="let team of teams()" [value]="team.id">{{ team.full_name }}</option></select></label>
      </div>
      <label>Completed games to compare<select [value]="sample()" (change)="sample.set(+$any($event.target).value)"><option [value]="5">Last 5</option><option [value]="10">Last 10</option><option [value]="20">Last 20</option></select></label>
      <button class="run" [disabled]="loading() || !left() || !right() || left() === right()" (click)="run()">{{ loading() ? 'Loading…' : 'Run comparison →' }}</button>
      <p class="hint">Scores and team-level form only. Player, injury, and advanced matchup analyses will be enabled when their data integrations are implemented.</p>
    </section>
    <section class="panel" *ngIf="sport() === 'tennis'"><div class="eyebrow">TENNIS / ATP · WTA · CHALLENGER</div><h2>Tennis research</h2><p>The tennis provider is not yet configured. Player comparison controls will be enabled after verifying tournament coverage and historical statistics.</p></section>
    <section class="panel" aria-live="polite"><h2>Results</h2>
      <p *ngIf="error()" class="error">{{ error() }}</p><p *ngIf="loading()">Retrieving provider data…</p>
      <p *ngIf="!loading() && !comparison() && !error()" class="hint">Choose two NBA teams and run a comparison.</p>
      <ng-container *ngIf="comparison() as c"><p class="meta">{{ c.source }} · {{ c.fetchedAt | date:'medium' }} · Last {{ c.sample }} games requested</p>
        <div class="columns">
          <div class="stats"><h3>{{ teamName(left()) }}</h3><p>{{ c.left.wins }}W–{{ c.left.losses }}L ({{ c.left.games }} games)</p><p>Scored: {{ c.left.pointsFor ?? '—' }} / game</p><p>Allowed: {{ c.left.pointsAgainst ?? '—' }} / game</p><p *ngFor="let g of c.left.recent">{{ g.date | date:'shortDate' }} · {{ g.scored }}–{{ g.allowed }} · {{ g.win ? 'W' : 'L' }}</p></div>
          <div class="stats"><h3>{{ teamName(right()) }}</h3><p>{{ c.right.wins }}W–{{ c.right.losses }}L ({{ c.right.games }} games)</p><p>Scored: {{ c.right.pointsFor ?? '—' }} / game</p><p>Allowed: {{ c.right.pointsAgainst ?? '—' }} / game</p><p *ngFor="let g of c.right.recent">{{ g.date | date:'shortDate' }} · {{ g.scored }}–{{ g.allowed }} · {{ g.win ? 'W' : 'L' }}</p></div>
        </div><p class="hint">{{ c.note }} <strong *ngIf="c.partial">Provider pagination indicates incomplete coverage.</strong></p>
      </ng-container>
    </section></ng-container>
    <section class="panel" *ngIf="tab() === 'markets'"><div class="eyebrow">MANUAL MARKET RESEARCH</div><h2>Market Scanner</h2><p>Select a provider and press Scan to retrieve a new market snapshot. No scheduled scans or automatic refresh.</p>
      <div class="sports"><button [class.selected]="provider() === 'kalshi'" (click)="chooseProvider('kalshi')">Kalshi</button><button [class.selected]="provider() === 'novig'" (click)="chooseProvider('novig')">Novig</button></div>
      <p *ngIf="provider() === 'novig'" class="hint">Novig integration is not configured yet.</p>
      <button class="run" [disabled]="scanLoading() || provider() === 'novig'" (click)="scan()">{{ scanLoading() ? 'Scanning…' : 'Scan now →' }}</button>
      <p *ngIf="scanError()" class="error">{{ scanError() }}</p>
      <ng-container *ngIf="scanResult() as result"><p class="meta">{{ result.source }} · {{ result.scannedAt | date:'medium' }} · {{ result.markets.length }} markets returned</p><p class="hint">{{ result.note }} <strong *ngIf="result.partialCoverage">More pages exist; this snapshot is incomplete.</strong></p>
        <div *ngFor="let m of result.markets" class="stats"><strong>{{ m.event }}</strong><p>{{ m.title }} · {{ m.ticker }}</p><p>YES bid {{ m.yesBid ?? '—' }} · YES ask {{ m.yesAsk ?? '—' }} · NO ask {{ m.noAsk ?? '—' }} · Last {{ m.last ?? '—' }} · 24h volume {{ m.volume24h ?? '—' }}</p></div>
      </ng-container>
    </section>
  </main>`,
  styles: [`
    :host{display:block;min-height:100vh;background:#0b1220;color:#e7edf7;font:16px system-ui,sans-serif}
    .workbench{max-width:960px;margin:auto;padding:40px 20px 80px}header{margin-bottom:28px}h1{font-size:clamp(2rem,5vw,3.4rem);letter-spacing:-.04em;margin:10px 0}h2{margin:0 0 20px}h3{margin:0}
    p{color:#a9b7cc;line-height:1.55}.eyebrow{font-size:12px;font-weight:800;letter-spacing:.17em;color:#73d8d0}.sports{display:flex;gap:12px;margin-bottom:22px}.sports button{flex:1}
    button,select{font:inherit;border:1px solid #354359;border-radius:10px;padding:12px 14px;background:#18263a;color:#f5f8fd}button{cursor:pointer}button.selected{border-color:#69d8d0;background:#123b45}button:disabled{opacity:.55;cursor:default}
    .panel{background:#111d2d;border:1px solid #29394e;border-radius:16px;padding:24px;margin-bottom:18px}label{display:block;margin:16px 0 7px;font-size:13px;color:#c3d0df}select{display:block;width:100%;box-sizing:border-box;margin-top:8px}
    .columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.run{width:100%;background:#69d8d0;color:#08242c;border:0;font-weight:800;margin-top:22px}.hint,.meta{font-size:13px}.error{color:#ffaaa6}.stats{padding:15px;background:#172538;border-radius:10px}
    .stats p{font-size:14px;border-bottom:1px solid #29394e;padding-bottom:6px}@media(max-width:650px){.columns{grid-template-columns:1fr}}
  `]
})
export class AppComponent {
  readonly tab = signal<'research' | 'markets'>('research');
  readonly provider = signal<'kalshi' | 'novig'>('kalshi');
  readonly scanLoading = signal(false); readonly scanError = signal(''); readonly scanResult = signal<ScanResult | null>(null);
  private scanId = 0;
  chooseTab(value: 'research' | 'markets'): void { this.tab.set(value); this.scanId++; this.scanLoading.set(false); this.scanError.set(''); this.scanResult.set(null); }
  chooseProvider(value: 'kalshi' | 'novig'): void { this.provider.set(value); this.scanId++; this.scanLoading.set(false); this.scanError.set(''); this.scanResult.set(null); }
  async scan(): Promise<void> {
    if (this.provider() !== 'kalshi' || this.scanLoading()) return;
    const id = ++this.scanId; this.scanLoading.set(true); this.scanError.set(''); this.scanResult.set(null);
    try {
      const response = await fetch('/api/markets/scan?provider=kalshi', { method: 'POST', cache: 'no-store' });
      const body = await response.json() as ScanResult & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Market scan unavailable');
      if (id === this.scanId && this.tab() === 'markets' && this.provider() === 'kalshi') this.scanResult.set(body);
    } catch(e) { if (id === this.scanId) this.scanError.set(e instanceof Error ? e.message : 'Scan unavailable'); }
    finally { if (id === this.scanId) this.scanLoading.set(false); }
  }
  readonly sport = signal<Sport>('nba');
  readonly teams = signal<Team[]>([]);
  readonly left = signal(0); readonly right = signal(0); readonly sample = signal(10);
  readonly loading = signal(false); readonly comparison = signal<Comparison | null>(null); readonly error = signal('');
  private requestId = 0;
  constructor() { void this.loadTeams(); }
  teamName(id: number): string { return this.teams().find(t => t.id === id)?.full_name ?? 'Team'; }
  chooseSport(value: Sport): void {
    this.requestId++; this.sport.set(value); this.loading.set(false); this.comparison.set(null); this.error.set('');
  }
  async loadTeams(): Promise<void> {
    try {
      const response = await fetch('/api/nba/teams', { cache: 'no-store' });
      const body = await response.json() as { teams?: Team[]; message?: string };
      if (!response.ok) throw new Error(body.message || 'Unable to load NBA teams');
      this.teams.set((body.teams || []).filter(t => t.id && t.full_name).sort((a,b) => a.full_name.localeCompare(b.full_name)));
    } catch(e) { if (this.sport() === 'nba') this.error.set(e instanceof Error ? e.message : 'Unable to load teams'); }
  }
  async run(): Promise<void> {
    if (this.sport() !== 'nba' || !this.left() || !this.right() || this.left() === this.right()) return;
    const id = ++this.requestId, a = this.left(), b = this.right(), n = this.sample();
    this.loading.set(true); this.error.set(''); this.comparison.set(null);
    try {
      const response = await fetch('/api/nba/compare?left=' + a + '&right=' + b + '&sample=' + n, { cache: 'no-store' });
      const body = await response.json() as Comparison & { message?: string; error?: string };
      if (!response.ok) throw new Error(body.message || body.error || 'Comparison unavailable');
      if (id === this.requestId && this.sport() === 'nba') this.comparison.set(body);
    } catch(e) { if (id === this.requestId && this.sport() === 'nba') this.error.set(e instanceof Error ? e.message : 'Unable to compare teams'); }
    finally { if (id === this.requestId) this.loading.set(false); }
  }
}
