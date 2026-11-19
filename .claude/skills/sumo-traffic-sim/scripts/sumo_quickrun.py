#!/usr/bin/env python3
"""Build (or reuse) a SUMO network, generate demand, run headless, summarise results.

Examples
  # synthetic 4x4 grid, 1 hour, one vehicle every 2 s
  python sumo_quickrun.py --grid 4 --end 3600 --period 2 --out runs/grid
  # existing network
  python sumo_quickrun.py --net my.net.xml --end 3600 --period 1.5 --out runs/mynet
  # real streets from an OpenStreetMap extract (.osm exported from openstreetmap.org)
  python sumo_quickrun.py --osm area.osm --end 1800 --period 3 --out runs/osm
Outputs in --out: net, trips, routes, .sumocfg, tripinfo.xml, summary.xml, results.json
"""
import argparse, json, os, statistics, subprocess, sys
import xml.etree.ElementTree as ET

import sumo  # pip install eclipse-sumo
SUMO_HOME = sumo.SUMO_HOME
os.environ.setdefault("SUMO_HOME", SUMO_HOME)
BIN = os.path.join(SUMO_HOME, "bin")
TOOLS = os.path.join(SUMO_HOME, "tools")


def run(cmd):
    print("$", " ".join(cmd), flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"FAILED ({r.returncode}):\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")
    return r


def main():
    p = argparse.ArgumentParser()
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--grid", type=int, help="build an N x N grid network")
    src.add_argument("--net", help="existing .net.xml")
    src.add_argument("--osm", help="OpenStreetMap .osm file to convert")
    p.add_argument("--end", type=int, default=3600, help="simulation end time [s]")
    p.add_argument("--period", type=float, default=2.0, help="mean seconds between departures")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--out", default="sumo_run")
    a = p.parse_args()

    os.makedirs(a.out, exist_ok=True)
    o = lambda f: os.path.join(a.out, f)
    net = o("net.net.xml")
    if a.grid:
        run([os.path.join(BIN, "netgenerate"), "--grid", "--grid.number", str(a.grid),
             "--grid.length", "200", "--default.lanenumber", "2", "--tls.guess", "true",
             "-o", net])
    elif a.osm:
        run([os.path.join(BIN, "netconvert"), "--osm-files", a.osm, "--geometry.remove",
             "--ramps.guess", "--junctions.join", "--tls.guess-signals", "--tls.join",
             "--remove-edges.isolated", "-o", net])
    else:
        net = a.net

    run([sys.executable, os.path.join(TOOLS, "randomTrips.py"), "-n", net, "-e", str(a.end),
         "-p", str(a.period), "--seed", str(a.seed), "--validate", "--fringe-factor", "5",
         "-o", o("trips.trips.xml"), "-r", o("routes.rou.xml")])

    cfg = o("run.sumocfg")
    with open(cfg, "w") as f:
        f.write(f"""<configuration>
  <input><net-file value="{os.path.abspath(net)}"/><route-files value="{os.path.abspath(o('routes.rou.xml'))}"/></input>
  <time><begin value="0"/><end value="{a.end * 2}"/></time>
  <output><tripinfo-output value="{os.path.abspath(o('tripinfo.xml'))}"/>
          <summary-output value="{os.path.abspath(o('summary.xml'))}"/></output>
  <processing><time-to-teleport value="300"/></processing>
  <random_number><seed value="{a.seed}"/></random_number>
  <report><no-step-log value="true"/></report>
</configuration>""")
    run([os.path.join(BIN, "sumo"), "-c", cfg])

    trips = ET.parse(o("tripinfo.xml")).getroot().findall("tripinfo")
    if not trips:
        sys.exit("No completed trips - check demand / network connectivity.")
    dur = [float(t.get("duration")) for t in trips]
    loss = [float(t.get("timeLoss")) for t in trips]
    wait = [float(t.get("waitingTime")) for t in trips]
    dist = [float(t.get("routeLength")) for t in trips]
    last = ET.parse(o("summary.xml")).getroot().findall("step")[-1]
    res = {
        "completed_trips": len(trips),
        "inserted": int(last.get("inserted")),
        "teleports": int(last.get("teleports", 0)),
        "mean_travel_time_s": round(statistics.mean(dur), 1),
        "p95_travel_time_s": round(sorted(dur)[int(0.95 * (len(dur) - 1))], 1),
        "mean_time_loss_s": round(statistics.mean(loss), 1),
        "mean_waiting_s": round(statistics.mean(wait), 1),
        "mean_speed_kmh": round(3.6 * sum(dist) / sum(dur), 1),
    }
    json.dump(res, open(o("results.json"), "w"), indent=2)
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
