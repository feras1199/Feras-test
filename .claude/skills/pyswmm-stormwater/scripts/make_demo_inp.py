#!/usr/bin/env python3
"""Write a small, valid SWMM 5 model to start from: 3 subcatchments -> 3 pits -> pipes -> outfall,
driven by a symmetric (Chicago-like) design storm. Edit areas, imperviousness, pipe sizes, rainfall.

  python make_demo_inp.py demo.inp --depth-mm 60 --duration-min 60 --dia 0.6
"""
import argparse

p = argparse.ArgumentParser()
p.add_argument("out"); p.add_argument("--depth-mm", type=float, default=60.0)
p.add_argument("--duration-min", type=int, default=60); p.add_argument("--dia", type=float, default=0.6)
a = p.parse_args()

# triangular hyetograph peaking mid-storm, 5-min blocks, intensities in mm/h summing to depth
n = a.duration_min // 5
w = [min(i + 1, n - i) for i in range(n)]
ints = [a.depth_mm * wi / sum(w) * 12 for wi in w]          # mm per block -> mm/h
ts = "\n".join(f"STORM            {i*5//60:02d}:{i*5%60:02d}      {v:.2f}" for i, v in enumerate(ints))
ts += f"\nSTORM            {n*5//60:02d}:{n*5%60:02d}      0"
d = a.dia
inp = f"""[TITLE]
Demo urban catchment ({a.depth_mm} mm in {a.duration_min} min)

[OPTIONS]
FLOW_UNITS           CMS
INFILTRATION         HORTON
FLOW_ROUTING         DYNWAVE
START_DATE           01/01/2026
START_TIME           00:00:00
REPORT_START_DATE    01/01/2026
REPORT_START_TIME    00:00:00
END_DATE             01/01/2026
END_TIME             04:00:00
WET_STEP             00:01:00
DRY_STEP             01:00:00
ROUTING_STEP         0:00:05
REPORT_STEP          00:01:00
ALLOW_PONDING        NO

[RAINGAGES]
;;Name  Format    Interval SCF Source
RG1     INTENSITY 0:05     1.0 TIMESERIES STORM

[SUBCATCHMENTS]
;;Name Raingage Outlet Area_ha %Imperv Width_m %Slope CurbLen
S1     RG1      J1     2.0     65      200     1.5    0
S2     RG1      J2     3.0     50      250     1.0    0
S3     RG1      J3     1.5     80      150     2.0    0

[SUBAREAS]
;;Subcat N-Imperv N-Perv S-Imperv S-Perv PctZero RouteTo
S1       0.015    0.10   1.5      5      25      OUTLET
S2       0.015    0.10   1.5      5      25      OUTLET
S3       0.015    0.10   1.5      5      25      OUTLET

[INFILTRATION]
;;Subcat MaxRate MinRate Decay DryTime MaxInf
S1       75      6       4     7       0
S2       75      6       4     7       0
S3       75      6       4     7       0

[JUNCTIONS]
;;Name Elev MaxDepth InitDepth SurDepth Aponded
J1     20.0 2.0      0         0        0
J2     19.0 2.0      0         0        0
J3     18.0 2.0      0         0        0

[OUTFALLS]
;;Name Elev Type
OUT1   17.0 FREE

[CONDUITS]
;;Name From To   Length Roughness InOff OutOff
C1     J1   J2   100    0.013     0     0
C2     J2   J3   100    0.013     0     0
C3     J3   OUT1 100    0.013     0     0

[XSECTIONS]
;;Link Shape    Geom1 Geom2 Geom3 Geom4 Barrels
C1     CIRCULAR {d}  0     0     0     1
C2     CIRCULAR {d}  0     0     0     1
C3     CIRCULAR {d}  0     0     0     1

[TIMESERIES]
;;Name           Time       Value(mm/h)
{ts}

[REPORT]
SUBCATCHMENTS ALL
NODES ALL
LINKS ALL
"""
open(a.out, "w").write(inp)
print(f"wrote {a.out}: peak intensity {max(ints):.1f} mm/h, total {a.depth_mm} mm")
