class ProgressBar {
  constructor(container, { accentColor = 'var(--claude-accent)', height = 6 } = {}) {
    this.accent = accentColor;

    this.track = document.createElement('div');
    this.track.className = 'progress-bar-track';
    this.track.style.height = height + 'px';
    this.track.style.borderRadius = (height / 2) + 'px';

    this.fill = document.createElement('div');
    this.fill.className = 'progress-bar-fill';
    this.fill.style.borderRadius = (height / 2) + 'px';
    this.fill.style.width = '0%';
    this.fill.style.background = accentColor;

    this.track.appendChild(this.fill);
    container.appendChild(this.track);
  }

  update(pct) {
    if (pct == null) {
      this.fill.style.width = '0%';
      this.fill.style.background = this.accent;
      return;
    }
    const clamped = Math.max(0, Math.min(100, pct));
    this.fill.style.width = clamped + '%';
    this.fill.style.background = this.getColor(clamped);
  }

  getColor(pct) {
    if (pct >= 95) return 'var(--status-bad)';
    if (pct >= 80) return 'var(--status-warn)';
    return this.accent;
  }

  destroy() {
    this.track.remove();
  }
}

window.ProgressBar = ProgressBar;
