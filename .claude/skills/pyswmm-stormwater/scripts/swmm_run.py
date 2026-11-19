#!/usr/bin/env python3
"""Run any EPA SWMM 5 .inp with pyswmm and print an engineering summary:
continuity errors, runoff depth, flooded / surcharged nodes, conduit peak flow, velocity, Max/Full flow.

  python swmm_run.py model.inp [--json results.json]

Units (SI model, FLOW_UNITS CMS): flows m3/s, volumes m3, depths m, durations h, rain/runoff mm.
Checked against the SWMM .rpt for the demo model (pyswmm 2.2, swmm-toolkit, SWMM 5.2).
Note: Simulation.runoff_error returned 0.0 in testing, so continuity comes from SystemStats.
"""
import argparse, json, os, re
from pyswmm import Simulation, Nodes, Links, SystemStats

p = argparse.ArgumentParser(); p.add_argument("inp"); p.add_argument("--json")
a = p.parse_args()

with Simulation(a.inp) as sim:
    for _ in sim:
        pass
    nodes = {n.nodeid: n.statistics for n in Nodes(sim)}
    links = {l.linkid: l.conduit_statistics for l in Links(sim) if l.is_conduit()}
    st = SystemStats(sim)
    routing, runoff = st.routing_stats, st.runoff_stats

# Max/Full flow ratio is only in the .rpt (Link Flow Summary): parse it if present
ratio = {}
rpt = os.path.splitext(a.inp)[0] + ".rpt"
if os.path.exists(rpt):
    txt = open(rpt).read()
    m = re.search(r"Link Flow Summary.*?-{20,}\n.*?-{20,}\n(.*?)\n\s*\n", txt, re.S)
    if m:
        for line in m.group(1).splitlines():
            f = line.split()
            if len(f) >= 8 and f[1] == "CONDUIT":
                ratio[f[0]] = float(f[-2])

r2 = lambda x: round(x, 3)
res = {
    "continuity_error_runoff_pct": r2(runoff["routing_error"]),
    "continuity_error_routing_pct": r2(routing["routing_error"]),
    "rainfall_mm": r2(runoff["rainfall"]), "runoff_mm": r2(runoff["runoff"]),
    "infiltration_mm": r2(runoff["infiltration"]),
    "system_inflow_m3": r2(routing["wet_weather_inflow"] + routing["dry_weather_inflow"] + routing["external_inflow"] + routing["groundwater_inflow"] + routing["II_inflow"]),
    "outfall_volume_m3": r2(routing["outflow"]), "flood_volume_m3": r2(routing["flooding"]),
    "nodes": {k: {"max_depth_m": r2(v["max_depth"]), "peak_inflow_cms": r2(v["peak_total_inflow"]),
                  "peak_flood_cms": r2(v["peak_flooding_rate"]), "flood_volume_m3": r2(v["flooding_volume"]),
                  "flood_hours": r2(v["flooding_duration"]), "surcharge_hours": r2(v["surcharge_duration"])}
              for k, v in nodes.items()},
    "conduits": {k: {"peak_flow_cms": r2(v["peak_flow"]), "peak_velocity_ms": r2(v["peak_velocity"]),
                     "max_over_full_flow": ratio.get(k), "hours_surcharged": r2(v["time_surcharged"]),
                     "hours_capacity_limited": r2(v["time_capacity_limited"])}
                 for k, v in links.items()},
}
print(json.dumps(res, indent=2))
flooded = [k for k, v in res["nodes"].items() if v["flood_volume_m3"] > 0]
over = [k for k, v in res["conduits"].items() if (v["max_over_full_flow"] or 0) > 1]
print("\nFLOODED NODES:", ", ".join(flooded) or "none")
print("CONDUITS OVER CAPACITY (Max/Full > 1):", ", ".join(over) or "none")
err = max(abs(res["continuity_error_runoff_pct"]), abs(res["continuity_error_routing_pct"]))
if err > 10:
    print("WARNING: continuity error > 10% - results not credible; fix model / shorten ROUTING_STEP.")
elif err > 5:
    print("CAUTION: continuity error > 5% - check model before reporting.")
if a.json:
    json.dump(res, open(a.json, "w"), indent=2)
