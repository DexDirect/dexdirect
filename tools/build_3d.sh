#!/usr/bin/env bash
# Rebuild the simulation playground assets (the "Try It in Simulation" section):
#   static/3d/robot.glb (+ robot.plain.glb)   what you see: the robot from the team's STEP, articulated
#   static/sim/dexdirect.xml, meta.json       what moves: the MuJoCo model (arm, MIDAS hand, table, cubes)
#   static/3d/hand_landmarker.task            MediaPipe hand model for the webcam mode
#
#   STEP=/path/to/Big_assem.step tools/build_3d.sh
#
# Inputs
#   STEP     Onshape export of the PiPER arm with the MIDAS hand and the L-shaped handle (geometry + colours)
#   cloned here: agilexrobotics/piper_ros (official PiPER URDF + meshes, MIT) and
#                midas-hand-org/midas_hand_mujoco (MIDAS URDF/MJCF, MIT)
# Needs: python3 with numpy, scipy, trimesh, pycollada, mujoco, cadquery-ocp (OCP) and fast-simplification;
#        git; node with npx (@gltf-transform/cli). WORK= keeps the intermediate files (a temp dir by default).
#
# What happens
#   1. STEP parts -> meshes; the official PiPER URDF and the MIDAS URDF are fitted to them (base pose + joint
#      angles, ~0.5 mm), every part is assigned to its link, and the arm covers missing from the STEP are cut
#      from the official PiPER meshes (coloured from AgileX's DAE files).
#   2. Articulated GLB: nodes J_<joint> rotate about the joint axis; decimated, then meshopt-compressed.
#   3. MuJoCo model (tools/sim/build_sim.py): PiPER links from the URDF with collision capsules, the MIDAS hand
#      MJCF (contact geoms, actuators, DIP linkages) mounted where the STEP puts it, gravity compensation on arm
#      and hand, the table, a tray and four 4 cm cubes, and a home keyframe solved so nothing touches at start.
set -euo pipefail
cd "$(dirname "$0")/.."
STEP=${STEP:?set STEP to the robot STEP file}
WORK=${WORK:-$(mktemp -d)}
T=tools/3d
mkdir -p "$WORK/src" "$WORK/model" static/3d static/sim
if [ ! -d "$WORK/src/piper_ros" ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/agilexrobotics/piper_ros.git "$WORK/src/piper_ros"
  git -C "$WORK/src/piper_ros" sparse-checkout set --no-cone '/src/piper_description/'
fi
[ -d "$WORK/src/midas_hand_mujoco" ] || git clone --depth 1 git@github.com:midas-hand-org/midas_hand_mujoco.git "$WORK/src/midas_hand_mujoco"
PD=$WORK/src/piper_ros/src/piper_description
HA=$WORK/src/midas_hand_mujoco/assets

python3 $T/step_leaves.py "$STEP" "$WORK/model/leaves" 0.2 0.35
python3 $T/register_piper.py "$WORK/model/leaves" "$PD" "$WORK/model/piper_reg.json"
python3 $T/arm_parts.py "$WORK/model/leaves" "$PD" "$WORK/model/piper_reg.json" "$WORK/model"
python3 $T/register_hand.py "$WORK/model/leaves" "$HA" "$WORK/model"
python3 $T/build_robot_glb.py "$WORK" "$WORK/model/robot_raw.glb" "$WORK/model/robot_joints.json" 0.17 0.15
python3 tools/sim/build_sim.py "$PD/urdf/piper_no_gripper_description.urdf" "$HA/midas_description/midas_whole_hand.xml" \
  "$WORK/model/robot_joints.json" static/sim/dexdirect.xml static/sim/meta.json
npx --yes @gltf-transform/cli@4 weld "$WORK/model/robot_raw.glb" "$WORK/model/robot_w.glb"
npx --yes @gltf-transform/cli@4 meshopt "$WORK/model/robot_w.glb" static/3d/robot.glb --level medium
cp "$WORK/model/robot_w.glb" static/3d/robot.plain.glb        # fallback where WebAssembly (meshopt) is blocked
[ -f static/3d/hand_landmarker.task ] || curl -L -o static/3d/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
echo "done (intermediates in $WORK)"
