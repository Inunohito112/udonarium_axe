import { seededRandom } from '@axe/core/util/seeded-random';
import { upFace } from '@axe/domain/dice/dice-3d/die-symmetry';
import { dieRadiusOf, DieShape, polyhedronOf } from '@axe/domain/dice/dice-3d/polyhedra';
import { Quat, Vec3 as Point } from '@axe/domain/dice/dice-3d/rotation';
import { throwSeedOf } from '@axe/domain/dice/dice-3d/throw-seed';
import { RestingDie, ThrowFault, throwFaultOf, Tray } from '@axe/domain/dice/dice-3d/throw-validation';
import {
  DiceThrowRequest,
  DiceThrowResult,
  FRAME_STRIDE,
  FRAMES_PER_SECOND,
  ThrowEdge,
} from '@axe/infrastructure/dice-3d/dice-physics-message';
import {
  Body,
  ContactMaterial,
  ConvexPolyhedron,
  Material,
  NaiveBroadphase,
  Plane,
  Quaternion,
  Vec3,
  World,
} from 'cannon-es';

/**
 * Gravity in the dice world, where a d6 is a little under one unit from its middle to a corner.
 *
 * Taken at the scale of a large, weighty die, about 30 mm along an edge, so the dice fly, bounce and
 * tumble at a pace the eye can follow and settle in one to two seconds, rather than skittering to a
 * stop as small dice do.
 */
const GRAVITY = 300;
const SUBSTEPS = 4;
/** The longest a throw is given to come to rest, about five and a half seconds. */
const MAX_FRAMES = 330;
/** How long the dice must stay still to count as settled, and how much of the stillness is kept. */
const STILL_FRAMES = 15;
const TAIL_FRAMES = 12;
const STILL_SPEED = 0.2;
const STILL_SPIN = 0.35;
/** How many times a spoiled throw is thrown again before the least spoiled is kept. */
export const MAX_ATTEMPTS = 8;

const FAULT_ORDER: readonly (ThrowFault | null)[] = [null, 'cocked', 'stacked', 'unsettled', 'outside'];

/**
 * Works out a throw of the dice onto the tray: how each die moves frame by frame and which face it
 * comes to rest on.
 *
 * The throw is seeded from what every peer shares about the roll, so all of them work out the same
 * throw. A throw whose dice do not settle, leave the tray, rest on one another or lean is thrown
 * again with the next seed; when every attempt is spoiled, the least spoiled is kept.
 */
export function simulateThrow(request: DiceThrowRequest): DiceThrowResult {
  let kept: DiceThrowResult | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const result = throwOnce(request, attempt);
    if (result.fault === null) return result;
    if (!kept || FAULT_ORDER.indexOf(result.fault) < FAULT_ORDER.indexOf(kept.fault)) kept = result;
  }
  return kept!;
}

function throwOnce(request: DiceThrowRequest, attempt: number): DiceThrowResult {
  const random = seededRandom(throwSeedOf(request.key, attempt));
  const { world, diceMaterial } = buildWorld(request.tray);
  const bodies = request.shapes.map((shape) => addDie(world, shape, diceMaterial));
  launch(bodies, request.shapes, request.tray, request.edge, random);

  const count = bodies.length;
  const frames = new Float32Array(MAX_FRAMES * count * FRAME_STRIDE);
  let recorded = 0;
  let stillFor = 0;
  let settledAt = -1;
  const step = 1 / (FRAMES_PER_SECOND * SUBSTEPS);

  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    for (let substep = 0; substep < SUBSTEPS; substep++) world.step(step);
    bodies.forEach((body, index) => {
      const at = (frame * count + index) * FRAME_STRIDE;
      frames[at] = body.position.x;
      frames[at + 1] = body.position.y;
      frames[at + 2] = body.position.z;
      frames[at + 3] = body.quaternion.x;
      frames[at + 4] = body.quaternion.y;
      frames[at + 5] = body.quaternion.z;
      frames[at + 6] = body.quaternion.w;
    });
    recorded = frame + 1;
    const still = bodies.every(
      (body) =>
        body.sleepState === Body.SLEEPING ||
        (body.velocity.length() < STILL_SPEED && body.angularVelocity.length() < STILL_SPIN)
    );
    stillFor = still ? stillFor + 1 : 0;
    if (settledAt < 0 && stillFor >= STILL_FRAMES) settledAt = frame;
    if (settledAt >= 0 && frame >= settledAt + TAIL_FRAMES) break;
  }

  const resting: RestingDie[] = bodies.map((body, index) => ({
    shape: request.shapes[index],
    position: [body.position.x, body.position.y, body.position.z] as Point,
    rotation: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w] as Quat,
  }));
  const fault = throwFaultOf(resting, request.tray, settledAt >= 0);
  return {
    frameCount: recorded,
    restFrame: settledAt >= 0 ? settledAt - STILL_FRAMES + 1 : recorded - 1,
    frames: frames.slice(0, recorded * count * FRAME_STRIDE),
    landed: resting.map((die) => upFace(polyhedronOf(die.shape), die.rotation)),
    attempt,
    fault,
  };
}

function buildWorld(tray: Tray): { world: World; diceMaterial: Material } {
  const world = new World({ gravity: new Vec3(0, 0, -GRAVITY), allowSleep: true });
  world.broadphase = new NaiveBroadphase();
  (world.solver as unknown as { iterations: number }).iterations = 16;

  const floorMaterial = new Material('floor');
  const wallMaterial = new Material('wall');
  const diceMaterial = new Material('dice');
  world.addContactMaterial(new ContactMaterial(diceMaterial, floorMaterial, { friction: 0.2, restitution: 0.45 }));
  world.addContactMaterial(new ContactMaterial(diceMaterial, wallMaterial, { friction: 0.12, restitution: 0.55 }));
  world.addContactMaterial(new ContactMaterial(diceMaterial, diceMaterial, { friction: 0.2, restitution: 0.5 }));

  world.addBody(new Body({ mass: 0, material: floorMaterial, shape: new Plane() }));
  // Each wall is a half-space facing into the tray, so a die moving however fast never ends up
  // behind one.
  const walls: [Point, Point][] = [
    [
      [tray.halfWidth, 0, 0],
      [0, -Math.PI / 2, 0],
    ],
    [
      [-tray.halfWidth, 0, 0],
      [0, Math.PI / 2, 0],
    ],
    [
      [0, tray.halfDepth, 0],
      [Math.PI / 2, 0, 0],
    ],
    [
      [0, -tray.halfDepth, 0],
      [-Math.PI / 2, 0, 0],
    ],
  ];
  for (const [[x, y, z], [rx, ry, rz]] of walls) {
    const wall = new Body({ mass: 0, material: wallMaterial, shape: new Plane() });
    wall.position.set(x, y, z);
    wall.quaternion.setFromEuler(rx, ry, rz);
    world.addBody(wall);
  }
  return { world, diceMaterial };
}

function addDie(world: World, shape: DieShape, material: Material): Body {
  const poly = polyhedronOf(shape);
  const radius = dieRadiusOf(shape);
  const solid = new ConvexPolyhedron({
    vertices: poly.vertices.map(([x, y, z]) => new Vec3(x * radius, y * radius, z * radius)),
    faces: poly.faces.map((face) => [...face]),
  });
  const body = new Body({
    mass: 1,
    material,
    shape: solid,
    linearDamping: 0.03,
    angularDamping: 0.04,
    allowSleep: true,
    sleepSpeedLimit: 0.3,
    sleepTimeLimit: 0.25,
  });
  world.addBody(body);
  return body;
}

/**
 * Sets the dice off from just inside one edge of the tray, a little above the floor and apart from
 * each other, each turned and spun its own way and flung toward somewhere about the middle.
 */
function launch(bodies: Body[], shapes: readonly DieShape[], tray: Tray, edge: ThrowEdge, random: () => number) {
  const along = edge === 'near' ? 'y' : 'x';
  const sign = edge === 'right' ? -1 : 1;
  const depthOf = along === 'x' ? tray.halfWidth : tray.halfDepth;
  const spanOf = along === 'x' ? tray.halfDepth : tray.halfWidth;
  const perRow = Math.max(1, Math.floor((spanOf * 2 - 1) / 2.4));
  bodies.forEach((body, index) => {
    const radius = dieRadiusOf(shapes[index]);
    const row = Math.floor(index / perRow);
    const column = index % perRow;
    const inRow = Math.min(perRow, bodies.length - row * perRow);
    const across = (column - (inRow - 1) / 2) * 2.4 + (random() - 0.5) * 0.6;
    const start = -sign * (depthOf - radius - 0.6 - row * 2.4);
    const height = 6 + radius + random() * 4 + row * 0.6;
    const position = along === 'x' ? new Vec3(start, across, height) : new Vec3(across, start, height);
    body.position.copy(position);

    const target = new Vec3((random() - 0.5) * tray.halfWidth * 0.8, (random() - 0.5) * tray.halfDepth * 0.8, 0);
    const toward = target.vsub(new Vec3(position.x, position.y, 0));
    toward.normalize();
    const speed = 60 + random() * 35;
    body.velocity.set(toward.x * speed, toward.y * speed, 4 + random() * 10);
    body.quaternion.copy(randomRotation(random));
    const axis = new Vec3(random() - 0.5, random() - 0.5, random() - 0.5);
    axis.normalize();
    const spin = 22 + random() * 22;
    body.angularVelocity.set(axis.x * spin, axis.y * spin, axis.z * spin);
  });
}

/** A rotation drawn evenly from all of them. */
function randomRotation(random: () => number): Quaternion {
  const u1 = random();
  const u2 = random() * 2 * Math.PI;
  const u3 = random() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return new Quaternion(a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3));
}
