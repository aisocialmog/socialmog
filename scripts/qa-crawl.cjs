// Walks the whole app in the design preview as every role, on desktop and phone, and reports:
// page errors, console errors, sideways scroll on phones, placeholder text ("arrives with feature"),
// pages that fail to load, and pages with no heading. Usage: node scripts/qa-crawl.cjs [baseUrl] [out.json]
// (npm run dev must be running; Playwright must be installed.)
const { chromium, devices } = require('playwright')
const BASE = process.argv[2] || 'http://localhost:4173', OUT = process.argv[3]
const START = ['/', '/brands', '/brands/new', '/creators', '/creators/new', '/creators/import', '/creators/shortlists', '/campaigns', '/campaigns/new', '/campaigns?view=board', '/production', '/production/mine', '/production/new', '/calendar',
  '/tasks', '/tasks?view=all', '/tasks?view=board', '/tasks?view=calendar', '/tasks?view=overdue', '/activity', '/activity?tab=daily',
  '/money', '/money/invoices', '/money/invoices/new', '/money/payments', '/money/expenses', '/money/payouts', '/money/payouts/due', '/money/capital', '/money/accounts', '/money/reports', '/money/reports?tab=gst', '/money/settings',
  '/reports', ...['brands', 'campaigns', 'creators', 'production', 'cashflow', 'ageing', 'capital', 'team'].map(r => '/reports?r=' + r),
  '/kaizen', '/kaizen?tab=muda', '/kaizen?tab=kaizen', '/kaizen?tab=hansei', '/ai', ...['plan', 'script', 'caption', 'match', 'summary', 'notes', 'followup', 'insight', 'ask'].map(t => '/ai?tool=' + t),
  '/settings', ...['appearance', 'company', 'lists', 'team', 'security', 'data'].map(t => '/settings?tab=' + t), '/settings/opening', '/settings/automations', '/settings/integrations', '/settings/ai', '/settings/health']
const shape = p => p.split('?')[0].split('/').map((seg, i) => i > 1 && /\d|^[a-z]{1,3}\d*$/i.test(seg) && !/^(new|edit|mine|due|report|import|shortlists|invoices|payments|expenses|payouts|capital|accounts)$/.test(seg) ? ':id' : seg).join('/')

;(async () => {
  const b = await chromium.launch(), report = []
  for (const role of (process.env.ROLES || 'founder,manager,team_member,freelancer').split(',')) {
    for (const [vp, opts] of [...(process.env.PHONE_ONLY ? [] : [['desktop', { viewport: { width: 1440, height: 900 } }]]), ['phone', devices['iPhone 13']]]) {
      const ctx = await b.newContext(opts); await ctx.addInitScript(r => sessionStorage.setItem('smog.preview-role', r), role)
      const p = await ctx.newPage(); p.on('dialog', d => d.dismiss())
      let errs = []; p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => m.type() === 'error' && errs.push('console: ' + m.text().slice(0, 200)))
      const seen = new Set(), perShape = {}, queue = [...START]
      while (queue.length && seen.size < (+process.env.CAP || 220)) {
        const path = queue.shift(); if (seen.has(path)) continue; seen.add(path)
        errs = []
        try { await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 20000 }); await p.waitForTimeout(250) } catch (e) { report.push({ role, vp, path, issue: 'failed to load: ' + e.message.slice(0, 80) }); continue }
        const info = await p.evaluate(() => ({
          text: (document.querySelector('main')?.innerText ?? document.body.innerText),
          h1: !!document.querySelector('main h1, main h2'), overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          links: [...document.querySelectorAll('main a[href^="/"]')].map(a => a.getAttribute('href')).filter(h => h && !h.startsWith('/share')),
        }))
        const final = new URL(p.url()).pathname + new URL(p.url()).search
        if (final.startsWith('/login')) { report.push({ role, vp, path, issue: 'redirected to login' }); continue }
        const add = i => report.push({ role, vp, path, issue: i })
        if (errs.length) add('errors: ' + [...new Set(errs)].slice(0, 3).join(' | '))
        if (vp === 'phone' && info.overflow) add('sideways scroll on phone')
        if (/arrives with feature|coming soon|\bTODO\b|undefined|\bNaN\b|\[object Object\]|Preview has no stand-in/i.test(info.text)) add('placeholder or broken text: ' + (info.text.match(/arrives with feature[^\n]*|coming soon|TODO|undefined|NaN|\[object Object\]|Preview has no stand-in[^\n]*/i) || [''])[0])
        if (!info.h1 && !/not allowed|isn.t here|path through the mist/i.test(info.text)) add('no heading')
        for (const l of info.links) { const s = shape(l); perShape[s] = (perShape[s] || 0) + 1; if (perShape[s] <= 2 && !seen.has(l)) queue.push(l) }
      }
      report.push({ role, vp, path: '(crawl)', issue: null, pages: seen.size })
      await ctx.close()
    }
  }
  await b.close()
  const problems = report.filter(r => r.issue)
  const groups = {}; for (const r of problems) (groups[r.issue + ' @ ' + r.path] ||= new Set()).add(`${r.role}/${r.vp}`)
  console.log(report.filter(r => r.pages).map(r => `${r.role}/${r.vp}: ${r.pages} pages`).join('\n'))
  console.log(Object.keys(groups).length ? '\nPROBLEMS\n' + Object.entries(groups).map(([k, v]) => `- ${k}  [${[...v].join(', ')}]`).join('\n') : '\nNo problems found.')
  if (OUT) require('fs').writeFileSync(OUT, JSON.stringify(report, null, 1))
})()
