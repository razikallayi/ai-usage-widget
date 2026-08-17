class App {
  constructor() {
    this.poller = new ApiPoller();
    this.countdowns = new CountdownManager();
    this.staleness = new StalenessTracker();
    this.tabController = new TabController();
    this.settings = new SettingsController();

    this.pages = [];
    this.viewMode = 'tabs';
    this.isDemo = false;
  }

  async init() {
    const claudeContainer = document.getElementById('page-claude');
    const codexContainer = document.getElementById('page-codex');
    const copilotContainer = document.getElementById('page-copilot');
    const antigravityContainer = document.getElementById('page-antigravity');

    this.pages = [
      new ClaudePage(claudeContainer, this.countdowns, this.staleness),
      new CodexPage(codexContainer, this.countdowns, this.staleness),
      new CopilotPage(copilotContainer, this.countdowns, this.staleness),
      new AntigravityPage(antigravityContainer, this.countdowns, this.staleness),
    ];

    this.tabController.init(
      document.querySelectorAll('.tab'),
      document.querySelectorAll('.page-content')
    );

    this.settings.init();
    this.settings.onSave = (cfg) => this.onConfigChange(cfg);

    document.addEventListener('data:update', (e) => this.onData(e.detail));
    document.addEventListener('data:tick', () => this.onTick());
    document.addEventListener('data:error', (e) => this.onError(e.detail));

    document.getElementById('setup-settings-btn')?.addEventListener('click', () => {
      this.hideSetup();
      this.settings.open();
    });
    document.getElementById('setup-demo-btn')?.addEventListener('click', () => {
      this.hideSetup();
      this.startDemo();
    });

    document.getElementById('btn-view')?.addEventListener('click', () => {
      this.setViewMode(this.viewMode === 'wide' ? 'tabs' : 'wide');
    });

    document.getElementById('btn-settings')?.addEventListener('click', () => this.settings.open());
    document.getElementById('btn-minimize')?.addEventListener('click', () => window.widget.minimize());
    document.getElementById('btn-pin')?.addEventListener('click', async () => {
      const config = await window.widget.getConfig();
      const newVal = !config.alwaysOnTop;
      await window.widget.setAlwaysOnTop(newVal);
      document.getElementById('btn-pin').classList.toggle('active', newVal);
    });

    if (window.widget) {
      window.widget.onAlwaysOnTopChange((val) => {
        document.getElementById('btn-pin')?.classList.toggle('active', val);
      });
    }

    const config = await window.widget.getConfig();
    document.getElementById('btn-pin')?.classList.toggle('active', config.alwaysOnTop !== false);
    // persist:false - main.js already sized the window for the saved mode.
    this.setViewMode(config.viewMode === 'wide' ? 'wide' : 'tabs', { persist: false });

    if (config.relayUrl && config.readToken) {
      this.hideSetup();
      this.poller.start(config.relayUrl, config.readToken, config.pollIntervalMs || 20000);
    } else {
      this.showSetup();
    }
  }

  // The window is resized by the main process on switch: four full-detail
  // columns need far more width than a single tab does.
  setViewMode(mode, { persist = true } = {}) {
    this.viewMode = mode === 'wide' ? 'wide' : 'tabs';
    document.body.classList.toggle('wide-mode', this.viewMode === 'wide');
    document.getElementById('btn-view')?.classList.toggle('active', this.viewMode === 'wide');

    if (persist) window.widget.setViewMode(this.viewMode);
  }

  onData(data) {
    this.hideError();

    const badge = document.getElementById('machine-badge');
    if (badge && data.machines) {
      badge.textContent = data.machines.length + (data.machines.length === 1 ? ' machine' : ' machines');
    }

    this.pages.forEach(page => page.update(data));

    const dot = document.getElementById('freshness-dot');
    if (dot) {
      dot.className = 'freshness-dot ' + this.staleness.getWorstLevel();
    }
  }

  onTick() {
    // Wide mode shows every column at once, so they all need their countdowns
    // ticking rather than just the active tab's.
    if (this.viewMode === 'wide') {
      this.pages.forEach(page => page.tick?.());
    } else {
      const activeIdx = this.tabController.getActiveIndex();
      this.pages[activeIdx]?.tick?.();
    }

    const dot = document.getElementById('freshness-dot');
    if (dot) {
      dot.className = 'freshness-dot ' + this.staleness.getWorstLevel();
    }
  }

  onError(detail) {
    const banner = document.getElementById('error-banner');
    if (banner) {
      banner.textContent = detail.message;
      banner.classList.add('visible');
    }
  }

  hideError() {
    const banner = document.getElementById('error-banner');
    if (banner) banner.classList.remove('visible');
  }

  showSetup() {
    const overlay = document.getElementById('setup-overlay');
    if (overlay) overlay.classList.remove('hidden');
  }

  hideSetup() {
    const overlay = document.getElementById('setup-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  startDemo() {
    this.isDemo = true;
    this.poller.stop();

    const tickTimer = setInterval(() => {
      document.dispatchEvent(new CustomEvent('data:tick', { detail: { elapsed: 0 } }));
    }, 1000);
    this._demoTickTimer = tickTimer;

    demo.start((data) => {
      document.dispatchEvent(new CustomEvent('data:update', { detail: data }));
    });
  }

  stopDemo() {
    this.isDemo = false;
    demo.stop();
    clearInterval(this._demoTickTimer);
  }

  onConfigChange(cfg) {
    if (this.isDemo) this.stopDemo();

    this.countdowns.clear();
    this.staleness.clear();
    this.poller.stop();

    if (cfg.relayUrl && cfg.readToken) {
      this.poller.start(cfg.relayUrl, cfg.readToken, cfg.pollIntervalMs || 20000);
    } else {
      this.showSetup();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
