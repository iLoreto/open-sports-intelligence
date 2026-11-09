import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';

type Sport = 'nba' | 'tennis';
interface Game { id: number; date: string; status: string; home_team: { id: number; full_name: string }; visitor_team: { id: number; full_name: string }; home_team_score: number; visitor_team_score: number }
interface GamesResponse { source: string; fetchedAt: string; games: Game[]; error?: string }

@Component({
  selector: 'osi-root',
  standalone: true,
  imports: [CommonModule],
  template: `
  <div class="workbench">
    <header><div class="eyebrow">OPEN SPORTS INTELLIGENCE</div><h1>Sports Research Workbench</h1><p>Choose a sport, select what to compare, and run a research request on demand.</p></header>
    <nav class="sports" aria-label="Sports">
      <button [class.selected]="sport() === 'nba'" (click)="chooseSport('nba')">🏀 NBA</button>
      <button [class.selected]="sport() === 'tennis'" (click)="chooseSport('tennis')">🎾 Tennis</button>
    </nav>
    <section class="panel">
      <div class="eyebrow">{{ sport() === 'nba' ? 'BALLDONTLIE / NBA' : 'TENNIS / INDEPENDENT DATASET' }}</div>
      <h2>What do you want to compare?</h2>
      <label for="mode">Analysis</label>
      <select id="mode" [value]="mode()" (change)="mode.set($any($event.target).value)">
        <option value="matchup">{{ sport() === 'nba' ? 'Team vs team' : 'Player vs player' }}</option>
        <option value="form">Recent form</option>
        <option value="full">Full matchup analysis</option>
      </select>
      <label for="sample">Historical sample</label>
      <select id="sample" [value]="sample()" (change)="sample.set(+$any($event.target).value)">
        <option [value]="5">Last 5</option><option [value]="10">Last 10</option><option [value]="20">Last 20</option>
      </select>
      <label for="date">Date (NBA)</label>
      <input id="date" type="date" [disabled]="sport() !== 'nba'" [value]="date()" (change)="date.set($any($event.target).value)" />
      <button class="run" [disabled]="loading()" (click)="run()">{{ loading() ? 'Loading…' : 'Run analysis →' }}</button>
      <p class="hint">No background scanning. Results are fetched only when requested.</p>
    </section>
    <section class="panel" aria-live="polite">
      <h2>Results</h2>
      <p *ngIf="error()" class="error">{{ error() }}</p>
      <p *ngIf="!loading() && !result() && !error()" class="hint">Run an analysis to retrieve sourced results.</p>
      <ng-container *ngIf="result() as data">
        <p class="meta">{{ data.source }} · Retrieved {{ data.fetchedAt | date:'medium' }} · {{ data.games.length }} games</p>
        <p *ngIf="!data.games.length">No games returned for this date.</p>
        <div class="game" *ngFor="let game of data.games">
          <strong>{{ game.visitor_team.full_name }} vs {{ game.home_team.full_name }}</strong>
          <span>{{ game.status }} · {{ game.visitor_team_score }}–{{ game.home_team_score }}</span>
        </div>
        <p class="hint">Team/player historical comparisons require additional licensed statistics endpoints. No inferred values are displayed.</p>
      </ng-container>
    </section>
  </div>`,
  styles: [`
    :host{display:block;min-height:100vh;background:#0b1220;color:#e7edf7;font:16px system-ui,sans-serif}
    .workbench{max-width:960px;margin:auto;padding:40px 20px 80px}header{margin-bottom:28px}
    h1{font-size:clamp(2rem,5vw,3.4rem);letter-spacing:-.04em;margin:10px 0}h2{margin:0 0 22px}
    p{color:#a9b7cc;line-height:1.55}.eyebrow{font-size:12px;font-weight:800;letter-spacing:.17em;color:#73d8d0}
    .sports{display:flex;gap:12px;margin-bottom:22px}.sports button{flex:1}
    button,select,input{font:inherit;border:1px solid #354359;border-radius:10px;padding:12px 14px;background:#18263a;color:#f5f8fd}
    button{cursor:pointer}button.selected{border-color:#69d8d0;background:#123b45}button:disabled{opacity:.55;cursor:default}
    .panel{background:#111d2d;border:1px solid #29394e;border-radius:16px;padding:24px;margin-bottom:18px}
    label{display:block;margin:16px 0 7px;font-size:13px;color:#c3d0df}select,input{width:100%;box-sizing:border-box}
    .run{width:100%;background:#69d8d0;color:#08242c;border:0;font-weight:800;margin-top:22px}
    .hint,.meta{font-size:13px}.error{color:#ffaaa6}.game{display:flex;justify-content:space-between;gap:12px;padding:15px 0;border-bottom:1px solid #29394e;flex-wrap:wrap}
    .game span{color:#b5c3d5}
  `]
})
export class AppComponent {
  readonly sport = signal<Sport>('nba');
  readonly mode = signal('matchup');
  readonly sample = signal(10);
  readonly date = signal(new Date().toLocaleDateString('en-CA'));
  readonly loading = signal(false);
  readonly result = signal<GamesResponse | null>(null);
  readonly error = signal('');
  chooseSport(value: Sport): void { this.sport.set(value); this.result.set(null); this.error.set(''); }
  async run(): Promise<void> {
    this.loading.set(true); this.error.set(''); this.result.set(null);
    try {
      const endpoint = this.sport() === 'nba' ? '/api/nba/games?date=' + encodeURIComponent(this.date()) : '/api/tennis/status';
      const response = await fetch(endpoint, { cache: 'no-store' });
      const data = await response.json() as GamesResponse & { message?: string };
      if (!response.ok) throw new Error(data.message || data.error || 'Data provider unavailable');
      if (this.sport() === 'tennis') throw new Error(data.message || 'Tennis provider is not configured');
      this.result.set(data);
    } catch (e) { this.error.set(e instanceof Error ? e.message : 'Unable to retrieve results'); }
    finally { this.loading.set(false); }
  }
}
