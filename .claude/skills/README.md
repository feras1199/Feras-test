# Project skills

Claude Code loads every folder here automatically when a session opens this repo. Each folder is one skill (`SKILL.md` plus optional scripts and references). Zipped copies for the claude.ai **Settings > Capabilities > Skills** upload page are in `/skill-uploads`.

First thing in a fresh container: `bash .claude/skills/install_deps.sh` (about 70 s).

## Written and tested here (2026-11-19)
| Skill | Fills which gap | Tested with |
|---|---|---|
| `sumo-traffic-sim` | Vissim/Aimsun can't run here; SUMO microsimulation can | 4x4 grid, 900 trips, TraCI signal control |
| `pyswmm-stormwater` | DRAINS/PCSWMM can't run here; EPA SWMM 5 can | 3-pit demo network, 450 vs 900 mm pipes, units checked against .rpt |

## From [K-Dense-AI/claude-scientific-skills](https://github.com/K-Dense-AI/claude-scientific-skills) (MIT, commit ec59a29, copied unmodified)
| Area | Skills |
|---|---|
| Stats and data | `statistical-analysis`, `statsmodels`, `exploratory-data-analysis` |
| Plots and figures | `matplotlib`, `scientific-visualization` |
| Networks, GIS, simulation, optimisation | `networkx`, `geopandas`, `geomaster`, `simpy`, `pymoo` |
| Maths and units | `sympy`, `uncertainty-and-units` |
| Research and writing | `literature-review`, `paper-lookup`, `citation-management`, `scientific-writing`, `peer-review`, `scientific-critical-thinking` |
| Documents | `markitdown` (PDF/Word/PPT/Excel to Markdown) |

## From [anthropics/skills](https://github.com/anthropics/skills) (Apache-2.0, commit e4bb5d9)
- `webapp-testing`: Playwright testing of local web apps.

## Screening done before install
- Scripts grepped for shell pipes, eval/exec, os.system, deletes and prompt-injection text. Nothing malicious found.
- Network hosts contacted: doi.org, OpenAlex, Crossref, arXiv, bioRxiv, NCBI/PubMed, DataCite, EBI. All public scholarly APIs.
- Optional paid service: `literature-review`'s schematic generator needs an `OPENROUTER_API_KEY`. Skip it; everything else works without keys.

## Still not fixable with a skill
No GPU, no commercial Windows software, no paywalled standards or journals, and some hosts (OpenStreetMap, BoM, ARR Data Hub) blocked by this environment's network policy.
