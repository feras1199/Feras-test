---
name: sumo-traffic-sim
description: Build, run and analyse microscopic traffic simulations with Eclipse SUMO (open-source alternative to Vissim/Aimsun) from Python on Linux. Use for road networks (grid, OSM import, existing .net.xml), demand generation, signal control via TraCI, scenario comparison (before/after, signal timing, lane changes), and travel time / delay / queue results. Tested in Claude Code cloud containers.
---

# SUMO traffic simulation

Tested 2026-11 in this container (Python 3.13, `eclipse-sumo` from PyPI, CPU only).

## Install (about 1 minute, no admin rights or GUI needed)
```bash
pip install eclipse-sumo traci sumolib
python -c "import sumo; print(sumo.SUMO_HOME)"   # binaries are in $SUMO_HOME/bin, tools in $SUMO_HOME/tools
```
Always set `os.environ["SUMO_HOME"] = sumo.SUMO_HOME` before importing sumolib tools.

## Fast path: one command end to end
`scripts/sumo_quickrun.py` builds or loads a network, generates random demand, runs SUMO headless and writes `results.json` (completed trips, mean/p95 travel time, time loss, waiting time, mean speed, teleports).
```bash
S=.claude/skills/sumo-traffic-sim/scripts
python $S/sumo_quickrun.py --grid 4 --end 3600 --period 2 --out runs/grid      # synthetic grid
python $S/sumo_quickrun.py --net my.net.xml --end 3600 --period 1.5 --out runs/a
python $S/sumo_quickrun.py --osm area.osm --end 1800 --period 3 --out runs/osm  # real streets
```
`--period` is the mean seconds between departures, so demand in veh/h is 3600/period.

## Live control with TraCI
`scripts/traci_example.py <cfg> --steps N` steps the sim, logs vehicles, mean speed and halted count every 60 s, and shows how to force a signal phase. Use it as the template for actuated or adaptive signals, ramp metering, incidents or RL. Useful calls: `traci.trafficlight.setPhase/setPhaseDuration/setProgramLogic`, `traci.lane.getLastStepHaltingNumber`, `traci.edge.getTraveltime`, `traci.vehicle.*`.

## Real road networks
- OpenStreetMap: export a `.osm` from openstreetmap.org (Export button) or BBBike and pass `--osm`. **In this cloud environment, api.openstreetmap.org and overpass-api.de are blocked by the network policy**, so ask the user to upload the file or to allow those hosts in the environment settings.
- `netconvert` flags used: `--geometry.remove --ramps.guess --junctions.join --tls.guess-signals --tls.join --remove-edges.isolated`. Always inspect the result: OSM lane counts, turn restrictions and signal locations are often wrong.

## Real demand (not random)
- Counts: `$SUMO_HOME/tools/routeSampler.py` fits routes to observed edge or turn counts (best for calibrating to SCATS or intersection counts).
- OD matrix: `od2trips` then `duarouter`. Use `$SUMO_HOME/tools/assign/duaIterate.py` for dynamic user equilibrium.
- Flows: `<flow id=".." from="edgeA" to="edgeB" begin="0" end="3600" vehsPerHour="800"/>` in a .rou.xml.

## Outputs worth enabling
`--tripinfo-output` (per-vehicle travel time and delay), `--summary-output` (network totals per step), `--queue-output`, `--edgedata-output` via an additional file `<edgeData id="e" file="edges.xml" period="900"/>` for link volumes and speeds, and E1/E2 detectors (`<inductionLoop>`, `<laneAreaDetector>`) to mimic loop detectors. Parse with `sumolib.output.parse` or ElementTree.

## Engineering rigour (do not skip)
- **Multiple seeds.** Microsimulation is stochastic. Run at least 5 seeds per scenario (check the guideline your project uses, e.g. TfNSW or Austroads modelling guidelines) and report mean and spread. Never compare scenarios on one seed.
- **Warm-up.** Discard the first 10 to 15 minutes, or until the network is loaded, before taking statistics.
- **Calibration and validation.** Compare modelled and observed link flows with the GEH statistic, GEH = sqrt(2(M-C)^2/(M+C)); a common target is GEH < 5 on at least 85% of links. Check travel times against observed data too.
- **Teleports** mean gridlock or a network error. More than a handful invalidates delay results: fix the network, don't hide it by raising `--time-to-teleport`.
- **Units.** SUMO uses metres, seconds and m/s internally.
- Random-trip demand only exercises the network. It is not a forecast of real traffic.

## Limits
- No GUI in the cloud. `sumo-gui` needs a display, so use headless `sumo` and plot results with matplotlib. For pictures, `$SUMO_HOME/tools/visualization/plotXMLAttributes.py` or `plot_net_dump.py` work headless.
- SUMO is not Vissim. If a unit or client requires Vissim or Aimsun output, use SUMO for exploration and say so.
