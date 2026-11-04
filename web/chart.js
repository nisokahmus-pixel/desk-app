/* Hand-drawn canvas charts. devicePixelRatio aware. No library. */
(function () {
  const RM = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT = '600 13px -apple-system, "SF Pro Text", system-ui, sans-serif';

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  const COLORS = { blue: '#0a84ff', green: '#00d35a', red: '#ff453a' };
  const BG = { blue: 'rgba(10,132,255,0.18)', green: 'rgba(0,211,90,0.18)', red: 'rgba(255,69,58,0.18)' };
  const ease = t => 1 - Math.pow(1 - t, 3);

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* ---------------- Home line chart ---------------- */
  class Line {
    constructor(canvas) { this.c = canvas; this.data = null; this.prev = null; this.seen = new Set(); this.raf = 0; }
    set(data) {
      const old = this.data;
      const sameRange = old && data && old.range === data.range;
      this.prev = sameRange ? old : null;
      if (!sameRange) this.seen = new Set((data && data.marks || []).map(k));
      this.data = data;
      const grew = sameRange && data.points.length && old.points.length &&
        data.points[data.points.length - 1][0] > old.points[old.points.length - 1][0];
      const fresh = (data && data.marks || []).filter(m => !this.seen.has(k(m)));
      this.fade = new Map(fresh.map(m => [k(m), 0]));
      fresh.forEach(m => this.seen.add(k(m)));
      cancelAnimationFrame(this.raf);
      if (RM() || (!grew && !fresh.length)) { this.slide = 1; this.fade.forEach((_, key) => this.fade.set(key, 1)); this.draw(); return; }
      const t0 = performance.now();
      const step = now => {
        const dt = now - t0;
        this.slide = grew ? ease(Math.min(1, dt / 250)) : 1;
        const f = Math.min(1, dt / 200);
        this.fade.forEach((_, key) => this.fade.set(key, f));
        this.draw();
        if (dt < 250) this.raf = requestAnimationFrame(step);
      };
      this.slide = grew ? 0 : 1; this.raf = requestAnimationFrame(step);
    }
    draw() {
      const { ctx, w, h } = setup(this.c); const d = this.data; if (!d) return;
      let pts = d.points.slice();
      const padL = 16, padR = 16, padB = 14;
      if (pts.length && this.prev && this.slide < 1) {
        // the newest point slides in from the previous last point
        const pl = this.prev.points[this.prev.points.length - 1], last = pts[pts.length - 1];
        pts[pts.length - 1] = [pl[0] + (last[0] - pl[0]) * this.slide, pl[1] + (last[1] - pl[1]) * this.slide];
      }
      const start = d.start;
      if (pts.length < 2) {
        // empty: dashed start line only
        ctx.strokeStyle = 'rgba(235,235,245,0.3)'; ctx.setLineDash([4, 5]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, h * 0.62); ctx.lineTo(w - padR, h * 0.62); ctx.stroke(); ctx.setLineDash([]);
        return;
      }
      const t0 = d.points[0][0], t1 = Math.max(pts[pts.length - 1][0], t0 + 1);
      let lo = Math.min(start, ...pts.map(p => p[1])), hi = Math.max(start, ...pts.map(p => p[1]));
      if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
      // marks: layout rows so they never overlap, a later mark moves up a row
      ctx.font = FONT;
      const marks = (d.marks || []).filter(m => m.ts >= t0 - 1).sort((a, b) => a.ts - b.ts);
      const ROW = 28, PH = 22;
      const X = t => padL + (w - padL - padR) * (t - t0) / (t1 - t0);
      // reserve head room for marks before mapping Y
      const placed = []; let maxRow = 0;
      for (const m of marks) {
        const tw = ctx.measureText(m.text).width + 16;
        let x = Math.min(Math.max(X(Math.min(m.ts, t1)) - tw / 2, 4), w - tw - 4);
        let row = 0;
        while (placed.some(p => p.row === row && x < p.x + p.w + 6 && x + tw + 6 > p.x)) row++;
        placed.push({ m, x, w: tw, row }); maxRow = Math.max(maxRow, row);
      }
      const padT = 10 + (marks.length ? (maxRow + 1) * ROW + 6 : 0);
      const Y = v => padT + (h - padT - padB) * (1 - (v - lo) / (hi - lo));
      // gradient fill under the line
      const g = ctx.createLinearGradient(0, padT, 0, h);
      g.addColorStop(0, 'rgba(0,211,90,0.28)'); g.addColorStop(1, 'rgba(0,211,90,0)');
      ctx.beginPath(); ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
      for (const p of pts) ctx.lineTo(X(p[0]), Y(p[1]));
      ctx.lineTo(X(pts[pts.length - 1][0]), h); ctx.lineTo(X(pts[0][0]), h); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      // dashed start value line
      ctx.strokeStyle = 'rgba(235,235,245,0.3)'; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(padL, Y(start)); ctx.lineTo(w - padR, Y(start)); ctx.stroke(); ctx.setLineDash([]);
      // line
      ctx.strokeStyle = '#00d35a'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))); ctx.stroke();
      const lp = pts[pts.length - 1];
      ctx.fillStyle = '#00d35a'; ctx.beginPath(); ctx.arc(X(lp[0]), Y(lp[1]), 4, 0, 7); ctx.fill();
      // marks above the line
      const valAt = t => { let v = pts[0][1]; for (const p of pts) { if (p[0] > t) break; v = p[1]; } return v; };
      for (const p of placed) {
        const a = this.fade.has(k(p.m)) ? this.fade.get(k(p.m)) : 1; if (a <= 0) continue;
        ctx.globalAlpha = a;
        const col = COLORS[p.m.color] || '#fff', y = 10 + (maxRow - p.row) * ROW;
        const mx = X(Math.min(p.m.ts, t1)), my = Y(valAt(p.m.ts));
        ctx.strokeStyle = col; ctx.globalAlpha = a * 0.5; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(mx, y + PH); ctx.lineTo(mx, my - 4); ctx.stroke();
        ctx.globalAlpha = a;
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(mx, my, 3.5, 0, 7); ctx.fill();
        ctx.fillStyle = '#000'; rrect(ctx, p.x, y, p.w, PH, 11); ctx.fill();
        ctx.fillStyle = BG[p.m.color] || 'rgba(255,255,255,.1)'; rrect(ctx, p.x, y, p.w, PH, 11); ctx.fill();
        ctx.fillStyle = col; ctx.textBaseline = 'middle'; ctx.fillText(p.m.text, p.x + 8, y + PH / 2 + 0.5);
      }
      ctx.globalAlpha = 1;
    }
  }
  const k = m => m.ts + '|' + m.kind + '|' + m.mint;

  /* ---------------- Coin candles with volume ---------------- */
  function candles(canvas, cs, exitLine, fmt) {
    const { ctx, w, h } = setup(canvas);
    const padL = 16, padR = 16, padT = 16, volH = h * 0.2, gap = 10, padB = 8;
    const data = (cs || []).slice(-80);
    if (!data.length) {
      ctx.fillStyle = 'rgba(235,235,245,0.6)'; ctx.font = '400 15px -apple-system, system-ui'; ctx.textAlign = 'center';
      ctx.fillText('No price ticks yet', w / 2, h / 2); return;
    }
    let lo = Math.min(...data.map(c => c[3])), hi = Math.max(...data.map(c => c[2]));
    if (exitLine) { lo = Math.min(lo, exitLine); hi = Math.max(hi, exitLine); }
    if (hi - lo <= 0) { hi *= 1.01; lo *= 0.99; }
    const r = (hi - lo) * 0.06; hi += r; lo -= r;
    const chartB = h - volH - gap - padB;
    const Y = v => padT + (chartB - padT) * (1 - (v - lo) / (hi - lo));
    const n = Math.max(data.length, 30), cw = (w - padL - padR) / n, bw = Math.max(1.5, cw * 0.62);
    const vmax = Math.max(...data.map(c => c[5] || 0)) || 1;
    data.forEach((c, i) => {
      const x = padL + cw * (i + 0.5) + (n - data.length) * cw;
      const up = c[4] >= c[1], col = up ? '#00d35a' : '#ff453a';
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(c[2])); ctx.lineTo(x, Y(c[3])); ctx.stroke();
      const top = Y(Math.max(c[1], c[4])), bot = Y(Math.min(c[1], c[4]));
      ctx.fillRect(x - bw / 2, top, bw, Math.max(1, bot - top));
      const vh = (c[5] || 0) / vmax * volH;
      ctx.globalAlpha = 0.45; ctx.fillRect(x - bw / 2, h - padB - vh, bw, vh); ctx.globalAlpha = 1;
    });
    if (exitLine) {
      const y = Y(exitLine);
      ctx.strokeStyle = '#ff9f0a'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '600 12px -apple-system, system-ui'; ctx.fillStyle = '#ff9f0a'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('Risk trailing stop · ' + fmt(exitLine), padL, y - 4);
    }
  }

  /* ---------------- Analyst score ring ---------------- */
  function ring(canvas, score) {
    const { ctx, w, h } = setup(canvas);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 8;
    ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.strokeStyle = '#2c2c2e'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    if (score != null) {
      const s = Math.max(0, Math.min(100, score));
      ctx.strokeStyle = s >= 70 ? '#00d35a' : '#ffd60a';
      ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * s / 100); ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 34px -apple-system, "SF Pro Display", system-ui';
    ctx.fillText(score == null ? '–' : String(Math.round(score)), cx, cy + 1);
  }

  window.DeskChart = { Line, candles, ring };
})();
