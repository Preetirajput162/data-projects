(() => {
  const D = window.MARITIME_DATA;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const pct = (v, d = 1) => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(d) + '%';
  const pctU = (v, d = 1) => (v * 100).toFixed(d).replace('-', '−') + '%';
  const fmt = v => v.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  const LY = D.meta.latest_year;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.ly').forEach(e => (e.textContent = LY));

  // theme
  const root = document.documentElement;
  root.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.getElementById('theme').onclick = () => { root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; drawAll(); };

  document.getElementById('meta').textContent =
    `Latest port data: ${LY} · Pipeline run ${D.meta.generated} · Port Resilience Index window ${D.meta.index_window.join('–')}`;

  // KPIs
  const k = D.kpis;
  document.getElementById('kpis').innerHTML = [
    [`${k.se_total_mt.toFixed(1)} Mt`, `Goods handled in Swedish main ports, ${LY}`, `<span class="${k.se_yoy < 0 ? 'neg' : 'pos'}">${pct(k.se_yoy)} vs ${LY - 1}</span>`],
    [pct(k.se_vs_peak), `Versus the ${k.se_peak_year} peak`, `<span class="muted">Peak-to-latest change</span>`],
    [pctU(k.top3_share, 0), `Share of the three largest ports`, `<span>${D.top_ports.ports.slice(0, 3).join(', ')}</span>`],
    [String(k.ports_reporting), `Ports reporting in ${LY}`, `<span>Eurostat port-level data</span>`],
  ].map(([v, l, d]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div><div class="d">${d}</div></div>`).join('');

  const charts = {};
  const base = () => {
    Chart.defaults.font.family = css('--font-body');
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css('--muted');
    Chart.defaults.borderColor = css('--border');
    Chart.defaults.animation = reduce ? false : { duration: 700, easing: 'easeOutQuart' };
    Chart.defaults.plugins.tooltip.backgroundColor = css('--text');
    Chart.defaults.plugins.tooltip.titleColor = css('--surface');
    Chart.defaults.plugins.tooltip.bodyColor = css('--surface');
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
  };
  const palette = () => ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'].map(css);
  const make = (id, cfg) => { charts[id]?.destroy(); charts[id] = new Chart(document.getElementById(id), cfg); };
  const grid = { color: () => css('--border') };

  function drawMix() {
    const s = D.cargo_mix.series, p = palette();
    make('mix', {
      type: 'line',
      data: { labels: D.cargo_mix.years, datasets: Object.keys(s).map((n, i) => ({ label: n, data: s[n], fill: true, backgroundColor: p[i] + 'CC', borderColor: p[i], borderWidth: 1, pointRadius: 0, tension: .25 })) },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { stacked: true, beginAtZero: true, grid, title: { display: true, text: 'Million tonnes' } }, x: { grid: { display: false } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)} Mt` } } } }
    });
    const y = D.cargo_mix.years, last = y.length - 1, f = y.indexOf(2005);
    const share = n => s[n][last] / Object.values(s).reduce((a, v) => a + v[last], 0);
    const big = Object.keys(s).sort((a, b) => s[b][last] - s[a][last]);
    document.getElementById('mixNote').textContent =
      `${big[0]} is the largest segment (${pctU(share(big[0]), 0)} of tonnage in ${LY}); containers changed ${pct(s['Containers'][last] / s['Containers'][f] - 1, 0)} since 2005.`;
  }

  function drawPorts() {
    const t = D.top_ports;
    make('ports', {
      type: 'bar',
      data: { labels: t.ports, datasets: [{ data: t.kt, backgroundColor: t.skane.map(s => s ? css('--skane') : css('--c1')), borderRadius: 3, barThickness: 'flex', maxBarThickness: 18 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.parsed.x)} kt` } } },
        scales: { x: { grid, ticks: { callback: v => fmt(v) } }, y: { grid: { display: false }, ticks: { autoSkip: false } } } }
    });
    const tot = D.kpis.se_total_mt * 1000;
    document.getElementById('portsNote').textContent =
      `Göteborg alone handles ${pctU(t.kt[0] / tot, 0)} of Swedish port tonnage. Trelleborg and Helsingborg are the largest Skåne ports; Ro-Ro (truck and trailer ferry) cargo makes up nearly all of Trelleborg's tonnage and 58% of Helsingborg's.`;
  }

  function drawIndex() {
    const comps = ['Growth', 'Stability', 'Downside protection', 'Cargo diversification'];
    const cc = [css('--c1'), css('--c2'), css('--c3'), css('--c4')];
    const n = D.index.length;
    document.getElementById('idxSub').textContent =
      `${n} Swedish ports, ${D.meta.index_window.join('–')} · 0–100, higher = more resilient · mean rank correlation under random weights: ${D.meta.spearman_robustness.toFixed(2)}`;
    const skane = new Set(['Malmö', 'Trelleborg', 'Helsingborg', 'Ystad', 'Landskrona', 'Åhus']);
    document.querySelector('#idx tbody').innerHTML = D.index.map(r => `
      <tr>
        <td class="rank">${r.rank}</td>
        <td class="port">${r.port}${skane.has(r.port) ? '<span class="tag">Skåne</span>' : ''}</td>
        <td class="num"><div class="score"><b>${r.index.toFixed(0)}</b><span class="bar"><i style="width:${r.index}%"></i></span></div></td>
        <td><div class="comps" title="${comps.map(c => `${c}: ${r[c].toFixed(0)}`).join(' · ')}">${comps.map((c, i) => `<span style="width:${Math.max(r[c], 2) * .45}px;background:${cc[i]}" aria-label="${c} ${r[c].toFixed(0)}"></span>`).join('')}</div></td>
        <td class="num ${r.cagr < 0 ? 'neg' : ''}">${pct(r.cagr)}</td>
        <td class="num">${pctU(r.max_drawdown, 0)}</td>
        <td class="rcell"><div class="range" aria-label="Rank ${r.rank_p5} to ${r.rank_p95}"><i style="left:${(r.rank_p5 - 1) / (n - 1) * 100}%;width:${Math.max((r.rank_p95 - r.rank_p5) / (n - 1) * 100, 1.5)}%"></i><b style="left:calc(${(r.rank - 1) / (n - 1) * 100}% - 1px)"></b></div><small class="rr">${r.rank_p5}–${r.rank_p95}</small></td>
      </tr>`).join('');
    document.getElementById('compLegend').innerHTML = comps.map((c, i) => `<span style="--sw:${cc[i]}">${c}</span>`).join('') + '<span style="--sw:var(--accent-2)">Rank marker = equal-weight rank; band = 5th–95th percentile rank</span>';
  }

  const defaultSel = new Set(['Sweden', 'Denmark', 'Finland', 'Norway', 'Poland', 'EU-27']);
  function chips() {
    const box = document.getElementById('chips');
    box.innerHTML = Object.keys(D.countries.series).map(c => `<button type="button" aria-pressed="${defaultSel.has(c)}">${c}</button>`).join('');
    box.onclick = e => { const b = e.target.closest('button'); if (!b) return; const c = b.textContent;
      defaultSel.has(c) ? defaultSel.delete(c) : defaultSel.add(c); b.setAttribute('aria-pressed', defaultSel.has(c)); drawCtry(); };
  }
  function drawCtry() {
    const s = D.countries.series, names = Object.keys(s);
    const colors = { 'Sweden': css('--c1'), 'EU-27': css('--text') };
    const extra = [css('--c4'), css('--c2'), css('--c5'), css('--c3'), '#7A39BB', '#A13544', '#6E522B', '#D19900', '#437A22'];
    let j = 0;
    make('ctry', {
      type: 'line',
      data: { labels: D.countries.years, datasets: names.filter(n => defaultSel.has(n)).map(n => ({ label: n, data: s[n], borderColor: colors[n] || extra[j++ % extra.length],
        borderWidth: n === 'Sweden' ? 3 : 1.6, borderDash: n === 'EU-27' ? [5, 4] : [], pointRadius: 0, tension: .2 })) },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { grid, title: { display: true, text: 'Index (2005 = 100)' } }, x: { grid: { display: false } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toFixed(0)}` } } } }
    });
  }

  function bench() {
    document.querySelector('#bench tbody').innerHTML = D.benchmark.map(r => `
      <tr${r.country === 'Sweden' ? ' style="font-weight:600"' : ''}><td>${r.country}</td>
      <td class="num">${r.volume_2024_mt.toFixed(0)}</td>
      <td class="num ${r.cagr_2005_2024 < 0 ? 'neg' : 'pos'}">${pct(r.cagr_2005_2024)}</td>
      <td class="num">${pctU(r.volatility)}</td>
      <td class="num ${r.shock_2009 < 0 ? 'neg' : ''}">${pct(r.shock_2009, 0)}</td>
      <td class="num neg">${pct(r.worst_year_change, 0)} <span style="color:var(--faint)">(${r.worst_year})</span></td>
      <td class="num ${r.vs_2019 < 0 ? 'neg' : 'pos'}">${pct(r.vs_2019, 0)}</td></tr>`).join('');
  }

  let wbKey = 'teu';
  function drawWB() {
    const src = D[wbKey], s = src.series;
    const pick = ['Sweden', 'Denmark', 'Finland', 'Norway', 'Poland', 'Lithuania'];
    const p = [css('--c1'), css('--c4'), css('--c2'), css('--c5'), css('--c3'), css('--faint')];
    document.getElementById('wbSub').textContent = wbKey === 'teu'
      ? `Container port traffic, million TEU, ${src.years[0]}–${src.years.at(-1)} · World Bank`
      : `UNCTAD Liner Shipping Connectivity Index (2004 max = 100), ${src.years[0]}–${src.years.at(-1)} · latest published year`;
    make('wb', {
      type: 'line',
      data: { labels: src.years, datasets: pick.filter(c => s[c]).map((c, i) => ({ label: c, data: s[c], borderColor: p[i], borderWidth: c === 'Sweden' ? 3 : 1.6, pointRadius: 0, tension: .2, spanGaps: true })) },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { grid }, x: { grid: { display: false } } }, plugins: { legend: { position: 'bottom' } } }
    });
  }
  document.querySelector('.tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; wbKey = b.dataset.k;
    document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b)); drawWB(); };

  function drawSkane() {
    const s = D.skane.series, p = [css('--skane'), css('--c1'), css('--c2'), css('--c5'), css('--c3'), css('--faint')];
    const order = Object.keys(s).sort((a, b) => (s[b].filter(v => v != null).at(-1)) - (s[a].filter(v => v != null).at(-1)));
    make('skane', {
      type: 'line',
      data: { labels: D.skane.years, datasets: order.map((n, i) => ({ label: n, data: s[n], borderColor: p[i % p.length], borderWidth: 2, pointRadius: 0, tension: .2, spanGaps: false })) },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { grid, title: { display: true, text: 'Million tonnes' } }, x: { grid: { display: false } } }, plugins: { legend: { position: 'bottom' } } }
    });
  }

  function findings() {
    const top = D.index[0], second = D.index[1];
    const se = D.benchmark.find(b => b.country === 'Sweden'), eu = D.benchmark.find(b => b.country === 'EU-27');
    const pl = D.benchmark.find(b => b.country === 'Poland');
    const stable = [...D.index].sort((a, b) => b.Stability - a.Stability)[0];
    const robust = D.index.filter(r => r.rank_p95 - r.rank_p5 <= 3).map(r => r.port);
    const items = [
      `Swedish port tonnage was ${D.kpis.se_total_mt.toFixed(1)} Mt in ${LY}, ${pct(D.kpis.se_yoy)} on the year and ${pct(D.kpis.se_vs_peak)} below the ${D.kpis.se_peak_year} peak — volumes have plateaued rather than grown.`,
      `${top.port} and ${second.port} top the Port Resilience Index, driven by growth and shallow drawdowns; ${stable.port} has the most stable year-to-year volumes.`,
      `Rankings are robust to weighting choices (mean rank correlation ${D.meta.spearman_robustness.toFixed(2)}); ${robust.length ? robust.slice(0, 4).join(', ') + ' keep a tight rank band under all weightings' : 'most ports keep a narrow rank band'}.`,
      `In the 2009 crisis Swedish volumes fell ${pct(se.shock_2009, 0)} versus ${pct(eu.shock_2009, 0)} for the EU-27; by 2024 Sweden stood ${pct(se.vs_2019, 0)} versus 2019.`,
      `Poland is the regional outlier, growing ${pct(pl.cagr_2005_2024)} a year since 2005 and ${pct(pl.vs_2019, 0)} above 2019, while Latvia and Estonia handled more than 40% less cargo in 2024 than in 2019.`,
    ];
    document.getElementById('findings').innerHTML = items.map(t => `<li>${t}</li>`).join('');
  }

  function drawAll() { base(); drawMix(); drawPorts(); drawCtry(); drawWB(); drawSkane(); }
  drawIndex(); bench(); chips(); findings(); drawAll();
})();
