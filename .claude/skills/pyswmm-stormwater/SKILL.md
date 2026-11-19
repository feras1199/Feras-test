---
name: pyswmm-stormwater
description: Build, run and post-process EPA SWMM 5 stormwater, drainage and sewer models from Python (pyswmm + swmm-toolkit) on Linux with no GUI. Use for pipe network capacity checks, pit flooding and surcharge, design storm runs, scenario and pipe-size comparisons, LID/WSUD what-ifs, real-time control (pumps, orifices, weirs) and batch or sensitivity runs. Open-source stand-in for DRAINS / PCSWMM / MIKE+ in exploration work. Tested in Claude Code cloud containers.
---

# SWMM stormwater modelling with pyswmm

Tested 2026-11 in this container: Python 3.13, pyswmm 2.2.0, swmm-toolkit (SWMM 5.2 engine), CPU only.

## Install (the gotcha)
`pip install pyswmm` **fails on Python 3.12+** because its dependency `julian` has a setup.py that no longer builds. pyswmm never imports it, so install without it:
```bash
pip install swmm-toolkit
pip install --no-deps pyswmm packaging
python -c "import pyswmm; print(pyswmm.__version__)"
```

## Fast path
```bash
S=.claude/skills/pyswmm-stormwater/scripts
python $S/make_demo_inp.py demo.inp --depth-mm 60 --duration-min 60 --dia 0.6   # starter model
python $S/swmm_run.py demo.inp --json results.json                              # any .inp
```
`swmm_run.py` reports continuity errors, rainfall/runoff/infiltration depths, flood and outfall volumes, and per-node peak inflow, flood volume, flood and surcharge hours. Per conduit it gives peak flow, velocity, Max/Full flow (parsed from the .rpt) and surcharged hours. It ends with a plain list of flooded nodes and over-capacity pipes.

The demo is 3 subcatchments, 3 pits, 3 pipes and a free outfall, driven by a triangular 5-min hyetograph. Treat it as a template to edit, not a design storm.

## pyswmm patterns
```python
from pyswmm import Simulation, Nodes, Links, Subcatchments, SystemStats
with Simulation("model.inp") as sim:
    sim.step_advance(300)              # optional: return control every 300 s instead of every routing step
    pump = Links(sim)["P1"]
    wet = Nodes(sim)["WW1"]
    for _ in sim:                      # real-time control loop
        pump.target_setting = 1.0 if wet.depth > 1.5 else 0.0
    stats = Nodes(sim)["J1"].statistics            # after the loop: peak_total_inflow, flooding_volume (m3), surcharge_duration (h)...
    cond  = Links(sim)["C1"].conduit_statistics    # peak_flow, peak_velocity, time_surcharged, time_capacity_limited
    sys_  = SystemStats(sim).routing_stats         # volumes m3, routing_error in %
```
- Edit a model programmatically: `swmmio` reads and writes .inp sections as pandas DataFrames (`swmmio.Model("m.inp").inp.conduits`). That's the easiest way to batch pipe sizes or imperviousness. It also pulls in `julian`, so install it the same way: `pip install geojson networkx pandas pillow pyproj pyshp pyyaml requests && pip install --no-deps swmmio`.
- Time series output: `from swmm.toolkit import output` reads the binary .out for any node/link/subcatchment series.
- Batch or sensitivity runs: write variants of the .inp, loop over `Simulation`, collect `swmm_run.py`-style dicts, then analyse with pandas.

## Units and verified facts
- With `FLOW_UNITS CMS`: flows in m3/s, `statistics` volumes in **m3** (the .rpt prints 10^6 L, so 182 m3 shows as 0.182), depths in m, durations in hours, `runoff_stats` rainfall/runoff in mm.
- `SystemStats(sim).runoff_stats["routing_error"]` and `.routing_stats["routing_error"]` match the .rpt "Continuity Error (%)". `Simulation.runoff_error` returned 0.0 in testing, so don't use it.
- Max/Full flow is only in the .rpt Link Flow Summary, not in the API.

## Australian practice (verify against the current documents)
- Design rainfall: ARR 2019 (Australian Rainfall and Runoff) using BoM IFD depths and ARR Data Hub temporal patterns. ARR uses AEP (e.g. 1% AEP), not ARI. ARR recommends an **ensemble of 10 temporal patterns** per duration and a check across durations to find the critical one. One synthetic storm is not compliant design.
- Council and state manuals set minor/major system criteria (e.g. pipes for a 10% or 5% AEP minor event, overland flow for the 1% AEP major event), freeboard and velocity-depth safety limits. Look up the specific council's manual. Don't assume.
- BoM and ARR Data Hub websites may be blocked from this cloud environment. Ask the user for the IFD table and temporal pattern CSVs, or to allow those hosts.

## Rigour checks before reporting
- Continuity errors: under ±5% is the usual sanity threshold, and under ±1 to 2% is good. If higher, reduce `ROUTING_STEP` (1 to 5 s for dynamic wave) or fix short conduits and instabilities.
- Check node `max_depth` against rim: depth = full depth with `ALLOW_PONDING NO` means overflow volume is lost from the system, not routed overland. Use 2D or dual-drainage modelling for overland flow paths.
- Subcatchment width and Manning's n strongly control the peak. Calibrate to gauged data if you have any; otherwise run a sensitivity test.
- SWMM is 1D. It does not replace DRAINS or TUFLOW where a council requires them. State that when results feed a real design.
