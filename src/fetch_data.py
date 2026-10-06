"""Download the raw open datasets used by the dashboard.

Sources (all public, no API key needed):
  * Eurostat mar_go_am_se  - goods handled in Swedish ports, by port and cargo type (annual, thousand tonnes)
  * Eurostat mar_mg_aa_cwhd - goods handled in all ports, country level (annual, thousand tonnes)
  * World Bank IS.SHP.GOOD.TU - container port traffic (TEU)
  * World Bank IS.SHP.GCNW.XQ - UNCTAD Liner Shipping Connectivity Index

Run:  python src/fetch_data.py
"""
from pathlib import Path
import requests

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"
EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
WB = "https://api.worldbank.org/v2/country/all/indicator/"

SOURCES = {
    "eurostat_se_ports_cargo.json": EUROSTAT + "mar_go_am_se?format=JSON&lang=EN&sinceTimePeriod=2005&direct=TOTAL&par_mar=TOTAL&natvessr=TOTAL",
    "eurostat_country_tonnes.json": EUROSTAT + "mar_mg_aa_cwhd?format=JSON&lang=EN&direct=TOTAL&unit=THS_T",
    "wb_teu.json": WB + "IS.SHP.GOOD.TU?format=json&per_page=20000&date=2000:2025",
    "wb_lsci.json": WB + "IS.SHP.GCNW.XQ?format=json&per_page=20000&date=2000:2025",
}


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        r = requests.get(url, timeout=120)
        r.raise_for_status()
        (RAW / name).write_bytes(r.content)
        print(f"saved {name} ({len(r.content):,} bytes)")


if __name__ == "__main__":
    main()
