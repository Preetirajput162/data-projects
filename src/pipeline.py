"""Clean, validate and analyse the raw maritime datasets.

Outputs
  data/processed/*.csv        tidy tables
  data/processed/validation.md data-quality report
  dashboard/data.json         compact data feed for the dashboard

Run:  python src/pipeline.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW, OUT, DASH = ROOT / "data" / "raw", ROOT / "data" / "processed", ROOT / "dashboard"
OUT.mkdir(parents=True, exist_ok=True)

CARGO = {"LBK": "Liquid bulk", "DBK": "Dry bulk", "LCNT": "Containers", "RO_MSP": "Ro-Ro (self-propelled)",
         "RO_MNSP": "Ro-Ro (non-self-propelled)", "OTH": "Other cargo"}
SKANE = {"Malmö", "Trelleborg", "Helsingborg", "Ystad", "Landskrona", "Åhus"}
PEERS = {"SE": "Sweden", "DK": "Denmark", "FI": "Finland", "NO": "Norway", "DE": "Germany", "NL": "Netherlands",
         "PL": "Poland", "EE": "Estonia", "LV": "Latvia", "LT": "Lithuania", "EU27_2020": "EU-27"}
WB_PEERS = {"SWE": "Sweden", "DNK": "Denmark", "FIN": "Finland", "NOR": "Norway", "DEU": "Germany",
            "NLD": "Netherlands", "POL": "Poland", "EST": "Estonia", "LVA": "Latvia", "LTU": "Lithuania"}
INDEX_START, INDEX_END = 2015, 2025
rng = np.random.default_rng(42)


# ---------------------------------------------------------------- loaders
def jsonstat_to_df(path: Path) -> pd.DataFrame:
    """Flatten a Eurostat JSON-stat 2.0 file into a long DataFrame."""
    d = json.loads(path.read_text())
    ids, sizes = d["id"], d["size"]
    cats = {k: list(d["dimension"][k]["category"]["index"].keys()) for k in ids}
    labels = {k: d["dimension"][k]["category"]["label"] for k in ids}
    rows = []
    for flat, value in d["value"].items():
        i, rec = int(flat), {}
        for k, s in zip(reversed(ids), reversed(sizes)):
            rec[k] = cats[k][i % s]
            i //= s
        rec["value"] = value
        rows.append(rec)
    df = pd.DataFrame(rows)
    df["time"] = df["time"].astype(int)
    df.attrs["labels"] = labels
    return df


def worldbank_to_df(path: Path) -> pd.DataFrame:
    _, rows = json.loads(path.read_text())
    return pd.DataFrame([{"iso3": r["countryiso3code"], "country": r["country"]["value"], "year": int(r["date"]),
                          "value": r["value"]} for r in rows]).dropna(subset=["value"])


# ---------------------------------------------------------------- metrics
def max_drawdown(s: pd.Series) -> float:
    return float((s / s.cummax() - 1).min())


def cagr(s: pd.Series) -> float:
    s = s.dropna()
    return float((s.iloc[-1] / s.iloc[0]) ** (1 / (s.index[-1] - s.index[0])) - 1)


def minmax(x: pd.Series, higher_is_better=True) -> pd.Series:
    z = (x - x.min()) / (x.max() - x.min())
    return 100 * (z if higher_is_better else 1 - z)


def main() -> None:
    checks: list[tuple[str, str, str]] = []

    # ---------- Swedish ports by cargo type
    ports = jsonstat_to_df(RAW / "eurostat_se_ports_cargo.json")
    plabel = ports.attrs["labels"]["rep_mar"]
    ports["port"] = ports["rep_mar"].map(plabel)
    dup = ports.duplicated(["rep_mar", "cargo", "time"]).sum()
    neg = (ports["value"] < 0).sum()
    checks += [("No duplicate port/cargo/year rows", "PASS" if dup == 0 else "FAIL", f"{dup} duplicates"),
               ("No negative tonnages", "PASS" if neg == 0 else "FAIL", f"{neg} negatives")]

    nat = ports[ports.rep_mar == "SE"].pivot(index="time", columns="cargo", values="value").sort_index()
    gap = (nat[list(CARGO)].sum(axis=1) - nat["TOTAL"]).abs() / nat["TOTAL"]
    checks.append(("Cargo types sum to national total (±1%)", "PASS" if (gap < 0.01).all() else "WARN",
                   f"max gap {gap.max():.2%}"))
    nat.rename(columns=CARGO).to_csv(OUT / "sweden_cargo_mix.csv")

    is_port = ports.rep_mar.str.match(r"^SE_\d[A-Z]{2}[A-Z0-9]{3}$") & ~ports.rep_mar.str.contains("88|SE0|SE02")
    pt = ports[is_port & (ports.cargo == "TOTAL")].pivot(index="time", columns="port", values="value").sort_index()
    pt.to_csv(OUT / "sweden_ports_total.csv")
    latest = int(pt.index.max())

    # ---------- composite Port Resilience Index (ports with full 2015-2025 data)
    win = pt.loc[INDEX_START:INDEX_END]
    full = win.columns[win.notna().all() & (win.loc[INDEX_END] >= 1000)]  # >= 1 million tonnes in latest year
    excluded_gaps = sorted(set(pt.columns[pt.loc[INDEX_START].fillna(0) >= 1000]) - set(full))
    checks.append((f"Ports with complete {INDEX_START}-{INDEX_END} series used in index", "INFO",
                   f"{len(full)} ports; excluded for gaps/confidentiality: {', '.join(excluded_gaps) or 'none'}"))
    win = win[full]
    logret = np.log(win).diff().dropna()
    mix = ports[is_port & ports.cargo.isin(CARGO) & (ports.time == INDEX_END)].pivot(
        index="port", columns="cargo", values="value").reindex(full).fillna(0)
    shares = mix.div(mix.sum(axis=1), axis=0)
    comp = pd.DataFrame({
        "volume_kt": win.loc[INDEX_END],
        "cagr": win.apply(cagr),
        "volatility": logret.std(),
        "max_drawdown": win.apply(max_drawdown),
        "diversification": 1 - (shares ** 2).sum(axis=1),
    })
    scores = pd.DataFrame({
        "Growth": minmax(comp.cagr),
        "Stability": minmax(comp.volatility, higher_is_better=False),
        "Downside protection": minmax(comp.max_drawdown),  # drawdown is negative: closer to 0 is better
        "Cargo diversification": minmax(comp.diversification),
    })
    comp = comp.join(scores)
    comp["index"] = scores.mean(axis=1)
    comp["rank"] = comp["index"].rank(ascending=False).astype(int)

    # robustness: 2,000 random weightings (Dirichlet) -> rank distribution
    W = rng.dirichlet(np.ones(4), size=2000)
    ranks = pd.DataFrame((scores.values @ W.T), index=scores.index).rank(ascending=False)
    comp["rank_p5"] = ranks.quantile(0.05, axis=1).round().astype(int)
    comp["rank_p95"] = ranks.quantile(0.95, axis=1).round().astype(int)
    comp["top5_share"] = (ranks <= 5).mean(axis=1)
    comp = comp.sort_values("index", ascending=False)
    comp.to_csv(OUT / "port_resilience_index.csv")
    spearman = np.mean([pd.Series(ranks[c]).corr(comp["rank"].reindex(ranks.index), method="spearman")
                        for c in ranks.columns[:500]])

    # ---------- country benchmark
    ctry = jsonstat_to_df(RAW / "eurostat_country_tonnes.json")
    ctry = ctry[ctry.rep_mar.isin(PEERS)].pivot(index="time", columns="rep_mar", values="value").sort_index()
    ctry = ctry.loc[2005:].rename(columns=PEERS)
    yoy = ctry.pct_change()
    bench = pd.DataFrame({
        "volume_2024_mt": ctry.loc[2024] / 1000,
        "cagr_2005_2024": ctry.apply(cagr),
        "volatility": np.log(ctry).diff().std(),
        "worst_year_change": yoy.min(),
        "worst_year": yoy.idxmin(),
        "shock_2009": yoy.loc[2009],
        "vs_2019": ctry.loc[2024] / ctry.loc[2019] - 1,
    }).sort_values("volume_2024_mt", ascending=False)
    bench.to_csv(OUT / "country_benchmark.csv")
    checks.append(("Country series coverage 2005-2024", "PASS" if ctry.loc[2005:2024].notna().all().all() else "WARN",
                   f"missing cells: {int(ctry.loc[2005:2024].isna().sum().sum())}"))

    # ---------- World Bank container & connectivity
    teu = worldbank_to_df(RAW / "wb_teu.json")
    teu = teu[teu.iso3.isin(WB_PEERS) & (teu.year >= 2010)].pivot(index="year", columns="iso3", values="value").rename(columns=WB_PEERS)
    lsci = worldbank_to_df(RAW / "wb_lsci.json")
    lsci = lsci[lsci.iso3.isin(WB_PEERS)].pivot(index="year", columns="iso3", values="value").rename(columns=WB_PEERS)
    teu.to_csv(OUT / "container_teu.csv"); lsci.to_csv(OUT / "lsci.csv")
    checks.append(("World Bank LSCI latest year", "INFO", f"{int(lsci.index.max())} (series not updated since)"))

    # ---------- dashboard feed
    def series(df):
        return {"years": [int(y) for y in df.index], "series": {c: [None if pd.isna(v) else round(float(v), 2) for v in df[c]] for c in df.columns}}

    top_ports = pt.loc[latest].dropna().sort_values(ascending=False)
    skane = pt[[c for c in pt.columns if c in SKANE]]
    feed = {
        "meta": {"latest_year": latest, "index_window": [INDEX_START, INDEX_END],
                 "spearman_robustness": round(float(spearman), 3), "generated": pd.Timestamp.now("UTC").strftime("%Y-%m-%d")},
        "kpis": {
            "se_total_mt": round(nat.loc[latest, "TOTAL"] / 1000, 1),
            "se_yoy": round(float(nat["TOTAL"].pct_change().loc[latest]), 4),
            "se_vs_peak": round(float(nat.loc[latest, "TOTAL"] / nat["TOTAL"].max() - 1), 4),
            "se_peak_year": int(nat["TOTAL"].idxmax()),
            "ports_reporting": int(top_ports.size),
            "top3_share": round(float(top_ports.iloc[:3].sum() / nat.loc[latest, "TOTAL"]), 4),
        },
        "cargo_mix": series(nat[list(CARGO)].rename(columns=CARGO) / 1000),
        "top_ports": {"ports": list(top_ports.index[:15]), "kt": [float(v) for v in top_ports.iloc[:15]],
                      "skane": [p in SKANE for p in top_ports.index[:15]]},
        "skane": series(skane / 1000),
        "index": [{"port": p, **{k: (round(float(v), 4) if isinstance(v, (float, np.floating)) else int(v))
                                 for k, v in r.items()}} for p, r in comp.iterrows()],
        "countries": series(ctry / ctry.loc[2005] * 100),
        "benchmark": [{"country": c, **{k: (int(v) if k == "worst_year" else round(float(v), 4)) for k, v in r.items()}}
                      for c, r in bench.iterrows()],
        "teu": series(teu / 1e6),
        "lsci": series(lsci),
    }
    blob = json.dumps(feed, ensure_ascii=False)
    (DASH / "data.json").write_text(blob)
    (DASH / "data.js").write_text("window.MARITIME_DATA = " + blob + ";\n")  # lets index.html open straight from disk

    rep = ["# Data validation report", "", "| Check | Result | Detail |", "|---|---|---|"]
    rep += [f"| {a} | {b} | {c} |" for a, b, c in checks]
    (OUT / "validation.md").write_text("\n".join(rep) + "\n")
    print("\n".join(rep))
    print("\nPort Resilience Index (top 10):")
    print(comp[["volume_kt", "cagr", "volatility", "max_drawdown", "diversification", "index", "rank_p5", "rank_p95"]].head(10).round(3))
    print(f"\nMean Spearman rank correlation vs equal weights: {spearman:.3f}")
    print(bench.round(3))


if __name__ == "__main__":
    main()
