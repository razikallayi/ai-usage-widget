const GAUGE_RADIUS = 60;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;
const ARC_FRACTION = 0.75;
const ARC_LENGTH = GAUGE_CIRCUMFERENCE * ARC_FRACTION;
const GAP_LENGTH = GAUGE_CIRCUMFERENCE - ARC_LENGTH;

// The track can use [ARC, GAP] because its offset is always 0: that draws the
// 270-degree groove exactly once.
//
// The fill must NOT. Its dash pattern is shifted by stroke-dashoffset to show
// progress, and ARC + GAP sums to exactly the circumference - so shifting it
// merely rotates the pattern and the same 270 degrees of colour stays visible
// at every percentage. Pairing ARC with a gap of a full circumference makes the
// pattern too long to wrap, so the offset genuinely shortens the visible arc.

// The gauge shows consumption: the ring fills and the centre reads "N% used",
// matching the weekly and per-model bars below it so the whole column uses one
// direction. The reset countdown sits directly under the figure because it is
// the next thing checked after the number itself.
class ArcGauge {
  constructor(container, { accentColor = 'var(--claude-accent)' } = {}) {
    this.accent = accentColor;
    // null, not 0: the per-second tick re-renders with currentPct, so a 0 here
    // would turn "no data" into a confident "0% used" / "100% left".
    this.currentPct = null;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'gauge-svg');
    svg.setAttribute('viewBox', '0 0 150 150');

    svg.innerHTML = `
      <circle class="gauge-track" cx="75" cy="75" r="${GAUGE_RADIUS}" stroke-width="10"
        stroke-dasharray="${ARC_LENGTH} ${GAP_LENGTH}" stroke-dashoffset="0"
        transform="rotate(-225 75 75)"/>
      <circle class="gauge-fill" cx="75" cy="75" r="${GAUGE_RADIUS}" stroke-width="10"
        stroke="${accentColor}"
        stroke-dasharray="${ARC_LENGTH} ${GAUGE_CIRCUMFERENCE}"
        stroke-dashoffset="${ARC_LENGTH}"
        stroke-linecap="round"
        transform="rotate(-225 75 75)"/>
      <text class="gauge-center-pct" x="75" y="66" text-anchor="middle" dominant-baseline="middle">--</text>
      <text class="gauge-center-caption" x="75" y="84" text-anchor="middle"></text>
      <text class="gauge-center-reset" x="75" y="101" text-anchor="middle"></text>
    `;

    this.fillEl = svg.querySelector('.gauge-fill');
    this.pctEl = svg.querySelector('.gauge-center-pct');
    this.captionEl = svg.querySelector('.gauge-center-caption');
    this.resetEl = svg.querySelector('.gauge-center-reset');

    container.appendChild(svg);
  }

  update(pct, resetText) {
    if (pct == null) {
      this.pctEl.innerHTML = '<tspan class="gauge-center-na">--</tspan>';
      this.captionEl.textContent = '';
      this.fillEl.setAttribute('stroke-dashoffset', ARC_LENGTH);
      this.fillEl.setAttribute('stroke', this.accent);
      this.currentPct = null;
    } else {
      const used = Math.max(0, Math.min(100, pct));

      const offset = ARC_LENGTH - (ARC_LENGTH * used / 100);
      this.fillEl.setAttribute('stroke-dashoffset', offset);
      this.pctEl.innerHTML = `${Math.round(used)}<tspan class="gauge-center-unit">%</tspan>`;
      this.captionEl.textContent = 'used';
      this.fillEl.setAttribute('stroke', this.getColor(used));
      this.currentPct = used;
    }
    this.resetEl.textContent = resetText || '';
  }

  // Thresholds are always expressed against usage, so they stay put regardless
  // of which way round the gauge is drawn.
  getColor(usedPct) {
    if (usedPct >= 95) return 'var(--status-bad)';
    if (usedPct >= 80) return 'var(--status-warn)';
    return this.accent;
  }

  setAccent(color) {
    this.accent = color;
    if (this.currentPct == null || this.currentPct < 80) {
      this.fillEl.setAttribute('stroke', color);
    }
  }

  destroy() {
    const svg = this.fillEl?.closest('svg');
    if (svg) svg.remove();
  }
}

window.ArcGauge = ArcGauge;
