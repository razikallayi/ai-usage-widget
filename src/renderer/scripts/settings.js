class SettingsController {
  constructor() {
    this.modal = document.getElementById('settings-modal');
    this.onSave = null;
    // The scale in force when the modal opened, so Cancel can undo a preview.
    this._scaleOnOpen = null;
  }

  init() {
    document.getElementById('settings-cancel').addEventListener('click', () => this.close());
    document.getElementById('settings-save').addEventListener('click', () => this.save());

    const opacitySlider = document.getElementById('settings-opacity');
    const opacityValue = document.getElementById('settings-opacity-value');
    opacitySlider.addEventListener('input', () => {
      opacityValue.textContent = Math.round(opacitySlider.value * 100) + '%';
    });

    // Unlike opacity, this previews live: picking a scale from a number is
    // guesswork, and the whole point is seeing whether it is readable.
    const scaleSlider = document.getElementById('settings-ui-scale');
    const scaleValue = document.getElementById('settings-ui-scale-value');
    scaleSlider.addEventListener('input', () => {
      const scale = parseFloat(scaleSlider.value);
      scaleValue.textContent = Math.round(scale * 100) + '%';
      window.widget?.setUiScale(scale);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
        this.close();
      }
    });

    if (window.widget) {
      window.widget.onShowSettings(() => this.open());
    }
  }

  async open() {
    const config = await window.widget.getConfig();

    document.getElementById('settings-relay-url').value = config.relayUrl || '';
    document.getElementById('settings-read-token').value = config.readToken || '';
    document.getElementById('settings-poll-interval').value = (config.pollIntervalMs || 20000) / 1000;
    document.getElementById('settings-opacity').value = config.opacity || 0.92;
    document.getElementById('settings-opacity-value').textContent = Math.round((config.opacity || 0.92) * 100) + '%';
    document.getElementById('settings-always-on-top').checked = config.alwaysOnTop !== false;

    const scale = config.uiScale || 1;
    this._scaleOnOpen = scale;
    document.getElementById('settings-ui-scale').value = scale;
    document.getElementById('settings-ui-scale-value').textContent = Math.round(scale * 100) + '%';

    this.modal.classList.remove('hidden');
  }

  // Cancel and Escape both undo the live scale preview; only save() keeps it.
  close({ revert = true } = {}) {
    if (revert && this._scaleOnOpen != null) {
      const slider = document.getElementById('settings-ui-scale');
      if (parseFloat(slider.value) !== this._scaleOnOpen) {
        window.widget?.setUiScale(this._scaleOnOpen);
      }
    }
    this._scaleOnOpen = null;
    this.modal.classList.add('hidden');
  }

  async save() {
    const relayUrl = document.getElementById('settings-relay-url').value.trim();
    const readToken = document.getElementById('settings-read-token').value.trim();
    const pollInterval = parseInt(document.getElementById('settings-poll-interval').value) || 20;
    const opacity = parseFloat(document.getElementById('settings-opacity').value);
    const alwaysOnTop = document.getElementById('settings-always-on-top').checked;
    const uiScale = parseFloat(document.getElementById('settings-ui-scale').value) || 1;

    // Remote relays must be https, but the bundled collector is plain http on
    // loopback - the traffic never leaves the machine.
    const isLoopback = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(relayUrl);
    const urlInput = document.getElementById('settings-relay-url');
    if (relayUrl && !relayUrl.startsWith('https://') && !isLoopback) {
      urlInput.classList.add('error');
      return;
    }
    urlInput.classList.remove('error');

    await window.widget.setConfig('relayUrl', relayUrl);
    await window.widget.setConfig('readToken', readToken);
    await window.widget.setConfig('pollIntervalMs', Math.max(10, Math.min(300, pollInterval)) * 1000);
    await window.widget.setOpacity(opacity);
    await window.widget.setAlwaysOnTop(alwaysOnTop);
    // Already applied live by the input handler; this pins it as the new baseline.
    await window.widget.setUiScale(uiScale);

    this.close({ revert: false });

    if (this.onSave) this.onSave({ relayUrl, readToken, pollIntervalMs: pollInterval * 1000, opacity, alwaysOnTop, uiScale });
  }
}

window.SettingsController = SettingsController;
