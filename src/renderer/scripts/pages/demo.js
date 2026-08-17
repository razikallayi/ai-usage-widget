function generateDemoData() {
  return {
    v: 1,
    serverTime: new Date().toISOString(),
    machines: [
      { id: 'work-pc', ageSec: 10 },
      { id: 'wsl-box', ageSec: 25 }
    ],
    claude: {
      limits: {
        ageSec: 15,
        session: { pct: 72, resetsInSec: 8040 },
        weekly: { pct: 45, resetsInSec: 275000 },
        extra: [
          { label: 'opus', pct: 62, resetsInSec: 275000 },
          { label: 'fable', pct: 38, resetsInSec: 275000 }
        ],
        extraUsage: { usedCreditsUsd: 12.34 }
      },
      tokens: {
        ageSec: 20,
        today: { in: 32100, out: 18400, cacheRead: 12200, cacheWrite: 3500, total: 66200 },
        week: { in: 185000, out: 102000, cacheRead: 71000, cacheWrite: 23900, total: 381900 },
        month: { in: 2600000, out: 1400000, cacheRead: 950000, cacheWrite: 350000, total: 5300000 },
        allTime: { in: 17200000, out: 9400000, cacheRead: 6100000, cacheWrite: 2400000, total: 35100000 },
        daily: [
          21, 48, 12, 0, 35, 62, 71, 44, 18, 5,
          52, 88, 64, 31, 27, 0, 0, 41, 76, 93,
          58, 34, 22, 67, 81, 49, 26, 55, 72, 38
        ].map(n => n * 1e6),
        costUsd: { month: 41.20, allTime: 313.00 }
      }
    },
    codex: {
      limits: {
        ageSec: 45,
        fiveHour: { pct: 45, resetsInSec: 10920 },
        weekly: { pct: 61, resetsInSec: 450000 },
        plan: 'plus'
      },
      tokens: {
        ageSec: 45,
        in: 350335, cached: 316160, cacheWrite: 0,
        out: 4285, reasoning: 2114, total: 354620,
        contextWindow: 258400
      },
      history: {
        ageSec: 45,
        today: { in: 350335, cached: 316160, out: 4285, reasoning: 2114, total: 354620 },
        week: { in: 1204880, cached: 1080400, out: 14920, reasoning: 7310, total: 1219800 },
        month: { in: 4740936, cached: 4263808, out: 26049, reasoning: 10765, total: 4766985 },
        allTime: { in: 9210442, cached: 8301155, out: 51880, reasoning: 21440, total: 9262322 },
        daily: [0, 0, 412000, 0, 0, 180000, 0, 0, 0, 620000, 0, 0, 0, 0, 233000, 0, 0, 0, 0, 0, 501000, 0, 0, 0, 0, 0, 0, 0, 0, 354620],
        sessions: 14
      }
    },
    copilot: {
      quota: {
        ageSec: 120,
        unlimited: false,
        used: 9459,
        included: 30000,
        remaining: 20541,
        pctUsed: 31.5,
        creditsUsed: 0,
        overageCount: 0,
        trend: {
          daily: [0, 12, 31, 8, 0, 0, 44, 27, 19, 5, 38, 52, 22, 9, 0, 0, 17, 41, 63, 28, 14, 6, 33, 47, 25, 11, 0, 29, 36, 21],
          perDay: 28.6,
          projected: 838,
          daysToReset: 15,
          observedDays: 7
        },
        chat: { unlimited: true },
        completions: { unlimited: true },
        resetsInSec: 1404000,
        resetDate: '2026-09-01',
        login: 'octocat',
        plan: 'business'
      }
    },
    antigravity: {
      activity: {
        ageSec: 30,
        stepsToday: 184,
        stepsWeek: 1203,
        stepsMonth: 4821,
        stepsTotal: 9640,
        conversations: 12,
        conversationsWeek: 4,
        lastActiveSec: 720,
        days: demoDays()
      },
      quota: {
        ageSec: 30,
        plan: 'Pro',
        groups: [
          {
            name: 'Gemini Models',
            models: 'Models within this group: Gemini Flash, Gemini Pro',
            windows: [
              { id: 'gemini-5h', label: '5-hour', window: '5h', usedPct: 10.3, remainingPct: 89.7, resetsInSec: 10342 },
              { id: 'gemini-weekly', label: 'Weekly', window: 'weekly', usedPct: 25, remainingPct: 75, resetsInSec: 163070 }
            ]
          },
          {
            name: 'Claude and GPT models',
            models: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS',
            windows: [
              { id: '3p-5h', label: '5-hour', window: '5h', usedPct: 0, remainingPct: 100, resetsInSec: 17899 },
              { id: '3p-weekly', label: 'Weekly', window: 'weekly', usedPct: 0, remainingPct: 100, resetsInSec: 604699 }
            ]
          }
        ]
      },
      quotaState: 'ok',
      quotaMessage: null
    }
  };
}

// Date-keyed map matching what the collector emits for Antigravity.
function demoDays() {
  const counts = [
    12, 40, 0, 25, 61, 88, 34, 19, 0, 52,
    77, 43, 28, 15, 66, 91, 38, 24, 0, 47,
    83, 59, 31, 22, 70, 95, 41, 26, 137, 184
  ];
  const days = {};
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  counts.forEach((count, idx) => {
    const d = new Date(cursor);
    d.setDate(d.getDate() - (counts.length - 1 - idx));
    const p = n => String(n).padStart(2, '0');
    days[d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())] = count;
  });
  return days;
}

let demoInterval = null;

function startDemo(onUpdate) {
  const data = generateDemoData();
  onUpdate(data);

  demoInterval = setInterval(() => {
    const d = generateDemoData();
    // Slightly vary values for realism
    d.claude.limits.session.pct = Math.min(100, 72 + Math.floor(Math.random() * 3));
    d.claude.limits.weekly.pct = Math.min(100, 45 + Math.floor(Math.random() * 2));
    d.codex.limits.fiveHour.pct = Math.min(100, 45 + Math.floor(Math.random() * 3));
    d.copilot.quota.used = 9459 + Math.floor(Math.random() * 50);
    d.copilot.quota.pctUsed = +(d.copilot.quota.used / 300).toFixed(1);
    onUpdate(d);
  }, 20000);
}

function stopDemo() {
  clearInterval(demoInterval);
  demoInterval = null;
}

window.demo = { start: startDemo, stop: stopDemo, generate: generateDemoData };
