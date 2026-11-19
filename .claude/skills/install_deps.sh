#!/usr/bin/env bash
# Installs the Python packages the skills in this folder use. Safe to re-run.
# Usage: bash .claude/skills/install_deps.sh
set -euo pipefail
PIP="python3 -m pip install -q"
# traffic (sumo-traffic-sim)
$PIP eclipse-sumo traci sumolib
# stormwater (pyswmm-stormwater): pyswmm/swmmio depend on 'julian', which fails to build on Python 3.12+
# and is never imported, so install them without deps.
$PIP swmm-toolkit packaging geojson networkx pandas pillow pyproj pyshp pyyaml requests
$PIP --no-deps pyswmm swmmio
# data / stats / plots / optimisation / units / docs (K-Dense scientific skills)
$PIP numpy scipy matplotlib seaborn statsmodels geopandas shapely simpy sympy pymoo pint uncertainties 'markitdown[all]' polars
python3 - <<'PY'
import sumo, pyswmm, swmmio, geopandas, statsmodels, pymoo, pint, uncertainties, simpy, sympy, markitdown
print("all skill dependencies OK | SUMO_HOME =", sumo.SUMO_HOME, "| pyswmm", pyswmm.__version__)
PY
