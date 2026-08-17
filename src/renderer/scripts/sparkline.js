const SPARK_NS = 'http://www.w3.org/2000/svg';

// Compact 30-day trend line. Scaled to its own max rather than to any limit -
// this shows shape of activity, not proximity to a quota.
class Sparkline {
  constructor(container, { accentColor = 'var(--text-muted)', height = 28 } = {}) {
    this.container = container;
    this.accentColor = accentColor;
    this.height = height;

    this.svg = document.createElementNS(SPARK_NS, 'svg');
    this.svg.setAttribute('class', 'sparkline');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.setAttribute('viewBox', '0 0 100 ' + height);

    this.area = document.createElementNS(SPARK_NS, 'path');
    this.area.setAttribute('fill', accentColor);
    this.area.setAttribute('opacity', '0.15');

    this.line = document.createElementNS(SPARK_NS, 'path');
    this.line.setAttribute('fill', 'none');
    this.line.setAttribute('stroke', accentColor);
    this.line.setAttribute('stroke-width', '1.5');
    this.line.setAttribute('stroke-linejoin', 'round');
    this.line.setAttribute('vector-effect', 'non-scaling-stroke');

    // A trailing dot would render as a stretched ellipse under
    // preserveAspectRatio="none", so the latest day is marked with a
    // full-height rule instead.
    this.marker = document.createElementNS(SPARK_NS, 'line');
    this.marker.setAttribute('stroke', accentColor);
    this.marker.setAttribute('stroke-width', '1');
    this.marker.setAttribute('vector-effect', 'non-scaling-stroke');
    this.marker.setAttribute('opacity', '0.5');

    this.svg.append(this.area, this.line, this.marker);
    this.container.appendChild(this.svg);
  }

  update(series) {
    if (!Array.isArray(series) || series.length < 2) {
      this.svg.style.display = 'none';
      return;
    }
    this.svg.style.display = '';

    const max = Math.max(...series);
    const pad = 2;
    const usable = this.height - pad * 2;
    const stepX = 100 / (series.length - 1);

    // A flat run of zeros should sit on the baseline, not spike to the top.
    const y = v => (max <= 0 ? this.height - pad : this.height - pad - (v / max) * usable);

    const points = series.map((v, i) => [i * stepX, y(v)]);
    const d = points.map(([px, py], i) => (i === 0 ? 'M' : 'L') + px.toFixed(2) + ' ' + py.toFixed(2)).join(' ');

    this.line.setAttribute('d', d);
    this.area.setAttribute('d', d + ` L100 ${this.height} L0 ${this.height} Z`);

    const [lastX, lastY] = points[points.length - 1];
    this.marker.setAttribute('x1', lastX.toFixed(2));
    this.marker.setAttribute('x2', lastX.toFixed(2));
    this.marker.setAttribute('y1', lastY.toFixed(2));
    this.marker.setAttribute('y2', String(this.height));
  }
}

window.Sparkline = Sparkline;
