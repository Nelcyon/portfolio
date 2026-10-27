// Posing for the Quaternius modular characters (CC0, see assets/CREDITS.md).
//
// The characters ship with walk/idle clips but nothing for sitting at a desk or
// holding a phone, so poses here are built from the idle pose with a little
// two-bone IK: the pelvis is set where the person sits, then each leg and arm
// is bent to reach a target. Targets are in the character's own space: meters,
// facing +Z, origin on the floor between the feet.

import * as THREE from 'three';

const V = () => new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function bones(root) {
  const b = {};
  root.traverse((o) => { if (o.isBone) b[o.name.replace(/[^A-Za-z0-9]/g, '')] = o; });
  return b;
}
const wpos = (o) => o.getWorldPosition(V());

// Turn a bone so its +Y (the way Blender bones point) runs along dir in world space.
function aim(bone, dir) {
  bone.updateWorldMatrix(true, false);
  const wq = bone.getWorldQuaternion(q1);
  const cur = UP.clone().applyQuaternion(wq);
  q2.setFromUnitVectors(cur, dir.clone().normalize());
  bone.parent.getWorldQuaternion(q3).invert();
  bone.quaternion.copy(q3.multiply(q2.multiply(wq)));
  bone.updateWorldMatrix(false, true);
}

// Bend upper/lower so the end of lower (len b) lands on target, the joint bowing toward pole.
function reach(upper, lower, a, b, target, pole) {
  const s = wpos(upper);
  const st = target.clone().sub(s);
  const d = Math.min(st.length(), (a + b) * 0.999);
  st.normalize();
  const x = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const side = pole.clone().sub(s);
  side.sub(st.clone().multiplyScalar(side.dot(st))).normalize();
  const joint = s.clone().addScaledVector(st, x).addScaledVector(side, h);
  aim(upper, joint.clone().sub(s));
  aim(lower, s.clone().addScaledVector(st, d).sub(wpos(lower)));
}

// Tip a bone about a world axis by angle (radians).
function tip(bone, axis, angle) {
  bone.updateWorldMatrix(true, false);
  const wq = bone.getWorldQuaternion(q1);
  q2.setFromAxisAngle(axis, angle);
  bone.parent.getWorldQuaternion(q3).invert();
  bone.quaternion.copy(q3.multiply(q2.multiply(wq)));
  bone.updateWorldMatrix(false, true);
}

// Curl every finger joint a little so hands don't look like paddles.
function curl(b, side, amount) {
  for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (let i = 2; i <= 4; i++) {
    const bone = b[f + i + side];
    if (bone) bone.rotateX(amount);
  }
}

/**
 * Pose a character in place. root must sit at the origin, unrotated and unscaled.
 * pose: {
 *   sit: seat height in meters (omit to stand),
 *   feet: [x, z] of the ankles when sitting (mirrored for the left foot),
 *   lean: forward lean of the back (radians), head: head pitch down (radians), turn: head yaw,
 *   hands: [[x, y, z], [x, y, z]] right then left hand targets, x outward from the middle,
 *   elbows: [x, y, z] which way the elbows bow (x outward), grip: finger curl,
 *   scale: how much the character will be scaled afterwards (targets are given at final size)
 * }
 * Returns the bones so callers can hang things off hands.
 */
export function posePerson(root, idle, pose = {}) {
  const b = bones(root);
  if (idle) {
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(idle).play();
    mixer.setTime(0);
    mixer.stopAllAction();
  }
  root.updateMatrixWorld(true);
  const k = 1 / (pose.scale || 1);
  const len = (p, c) => wpos(p).distanceTo(wpos(c));
  const thigh = len(b.UpperLegR, b.LowerLegR), shin = len(b.LowerLegR, b.FootR);
  const upperArm = len(b.UpperArmR, b.LowerArmR), foreArm = len(b.LowerArmR, b.WristR);

  if (pose.sit != null) {
    // Drop the pelvis so the thighs rest on the seat, a little behind the origin.
    const hipY = wpos(b.UpperLegR).y;
    const drop = hipY - (pose.sit * k + 0.08);
    b.Body.parent.worldToLocal(b.Body.position.copy(wpos(b.Body).add(new THREE.Vector3(0, -drop, -0.08))));
    root.updateMatrixWorld(true);
    const [fx, fz] = pose.feet || [0.11, 0.42];
    for (const [s, sx] of [['R', -1], ['L', 1]]) {
      const ankle = new THREE.Vector3(sx * fx, 0.08, fz * k);
      const foot = b['Foot' + s];
      // The feet are IK handles parented to Root, so they just move.
      foot.parent.worldToLocal(foot.position.copy(ankle));
      foot.updateWorldMatrix(false, true);
      reach(b['UpperLeg' + s], b['LowerLeg' + s], thigh, shin, ankle, wpos(b['UpperLeg' + s]).add(new THREE.Vector3(0, 0.3, 1)));
    }
  }
  if (pose.lean) { tip(b.Abdomen, new THREE.Vector3(1, 0, 0), pose.lean * 0.5); tip(b.Chest, new THREE.Vector3(1, 0, 0), pose.lean * 0.5); }
  if (pose.turn) tip(b.Neck, UP, pose.turn);
  if (pose.head) tip(b.Head, new THREE.Vector3(1, 0, 0), pose.head);
  if (pose.hands) {
    const [ex, ey, ez] = pose.elbows || [0.35, -0.2, -0.1];
    pose.hands.forEach((h, i) => {
      const [x, y, z] = h.map((v) => v * k);
      // x is measured outward from the middle: the right side is -X.
      const s = i ? 'L' : 'R', m = i ? 1 : -1;
      const shoulder = wpos(b['UpperArm' + s]);
      reach(b['UpperArm' + s], b['LowerArm' + s], upperArm, foreArm, new THREE.Vector3(x * m, y, z), shoulder.add(new THREE.Vector3(ex * m, ey, ez)));
      // Hand carries on along the forearm, tipped down a touch
      aim(b['Wrist' + s], new THREE.Vector3(x * m, y, z).sub(wpos(b['LowerArm' + s])).add(new THREE.Vector3(0, -0.06, 0)));
      curl(b, s, pose.grip ?? 0.35);
    });
  }
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingSphere(); o.computeBoundingBox(); } });
  return b;
}
