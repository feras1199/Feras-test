#!/usr/bin/env python3
"""Minimal TraCI loop: step a .sumocfg, log network state, optionally force a signal phase.

  python traci_example.py runs/grid/run.sumocfg --steps 600
"""
import argparse, os
import sumo, traci  # pip install eclipse-sumo traci
os.environ.setdefault("SUMO_HOME", sumo.SUMO_HOME)

p = argparse.ArgumentParser(); p.add_argument("cfg"); p.add_argument("--steps", type=int, default=600)
a = p.parse_args()
traci.start([os.path.join(sumo.SUMO_HOME, "bin", "sumo"), "-c", a.cfg, "--no-step-log", "true",
             "--tripinfo-output", os.devnull, "--summary-output", os.devnull])
tls = traci.trafficlight.getIDList()
print(f"{len(tls)} signalised junctions: {tls[:5]}")
for step in range(a.steps):
    traci.simulationStep()
    if step % 60 == 0:
        veh = traci.vehicle.getIDList()
        mean_v = sum(traci.vehicle.getSpeed(v) for v in veh) / len(veh) if veh else 0
        halted = sum(traci.lane.getLastStepHaltingNumber(l) for l in traci.lane.getIDList())
        print(f"t={traci.simulation.getTime():6.0f}s vehicles={len(veh):4d} mean_speed={mean_v*3.6:5.1f} km/h halted={halted}")
    # example control: hold first signal in phase 0 for the first 300 s
    if tls and step < 300:
        traci.trafficlight.setPhase(tls[0], 0)
traci.close()
