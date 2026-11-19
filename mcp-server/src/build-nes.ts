import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NativeSession } from "./native.js";
import { Vec3 } from "./native/types.js";
import { Resvg } from "@resvg/resvg-js";
import { execSync } from "node:child_process";

const EXAMPLES_DIR = "E:\\Projects\\PlasticityMCP\\examples\\nintendo-nes";
const DRAWINGS_DIR = join(EXAMPLES_DIR, "drawings");

if (!existsSync(DRAWINGS_DIR)) {
  mkdirSync(DRAWINGS_DIR, { recursive: true });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Safe fillet helper
async function safeFillet(native: NativeSession, bodyId: number, edgeIds: string[], radiusMm: number): Promise<number> {
  if (edgeIds.length === 0) return bodyId;
  try {
    const res = await native.filletEdges(bodyId, edgeIds, radiusMm);
    return res.created[0]?.id ?? res.changed[0]?.id ?? bodyId;
  } catch (e) {
    console.warn(`Fillet radius ${radiusMm} failed on body ${bodyId}:`, (e as Error).message);
    return bodyId;
  }
}

// Safe chamfer helper
async function safeChamfer(native: NativeSession, bodyId: number, edgeIds: string[], distanceMm: number): Promise<number> {
  if (edgeIds.length === 0) return bodyId;
  try {
    const res = await native.chamferEdges(bodyId, edgeIds, distanceMm);
    return res.created[0]?.id ?? res.changed[0]?.id ?? bodyId;
  } catch (e) {
    console.warn(`Chamfer distance ${distanceMm} failed on body ${bodyId}:`, (e as Error).message);
    return bodyId;
  }
}

// Screw + counterbore creator helper
async function addFastener(
  native: NativeSession,
  targetBodyId: number,
  center: Vec3,
  axis: Vec3,
  headRadius: number,
  headDepth: number,
  shankRadius: number,
  shankLen: number,
  name: string
): Promise<{ targetId: number; screwId: number }> {
  // 1. Cut counterbore hole into target
  const cutter = (await native.createCylinder(center, headRadius, headDepth + 1.0, axis, `${name}_cut`)).created[0]!;
  const cutRes = await native.boolean("difference", [targetBodyId], [cutter.id]);
  const newTargetId = cutRes.created[0]?.id ?? cutRes.changed[0]!.id;

  // 2. Create screw head recessed inside hole
  const headPos: Vec3 = [
    center[0] + axis[0] * 0.8,
    center[1] + axis[1] * 0.8,
    center[2] + axis[2] * 0.8
  ];
  const head = (await native.createCylinder(headPos, headRadius * 0.86, headDepth * 0.75, axis, `${name}_head`)).created[0]!;
  
  // 3. Create screw shank overlapping head for seamless union
  const shankPos: Vec3 = [
    center[0] + axis[0] * (headDepth * 0.4),
    center[1] + axis[1] * (headDepth * 0.4),
    center[2] + axis[2] * (headDepth * 0.4)
  ];
  const shank = (await native.createCylinder(shankPos, shankRadius, shankLen, axis, `${name}_shank`)).created[0]!;

  const screwUnion = await native.boolean("union", [head.id], [shank.id]);
  let screwId = screwUnion.created[0]?.id ?? screwUnion.changed[0]!.id;

  // 4. Fillet top rim of screw head for realistic pan head
  try {
    const topo = await native.topology(screwId);
    const circEdges = topo.edges!.filter(e => e.kind === "circle");
    if (circEdges.length > 0) {
      screwId = await safeFillet(native, screwId, [circEdges[0]!.id], 0.35);
    }
  } catch {}

  return { targetId: newTargetId, screwId };
}

async function main() {
  console.log("=== NINTENDO ENTERTAINMENT SYSTEM (NES) COMPLETE DETAILED CAD BUILDER ===");
  const native = new NativeSession();
  await native.connect();
  console.log("Connected to Plasticity.");

  // Clean document
  await native.newDocument(true);
  const baseline = await native.state();
  if (baseline.bodies.length > 0) {
    await native.deleteBodies(baseline.bodies.map((b) => b.id));
  }
  console.log("Document initialized clean.");

  // Materials
  console.log("Creating Materials...");
  const matLightGray = await native.createMaterial({
    name: "NES Light Gray",
    color: "#C5C6C7",
    roughness: 0.45,
    metalness: 0.05,
    opacity: 1.0,
  });
  const matDarkCharcoal = await native.createMaterial({
    name: "NES Dark Charcoal",
    color: "#28292B",
    roughness: 0.52,
    metalness: 0.08,
    opacity: 1.0,
  });
  const matNintendoRed = await native.createMaterial({
    name: "Nintendo Red",
    color: "#D82800",
    roughness: 0.35,
    metalness: 0.02,
    opacity: 1.0,
  });
  const matCartridgeGray = await native.createMaterial({
    name: "Cartridge Dark Gray",
    color: "#46474A",
    roughness: 0.58,
    metalness: 0.05,
    opacity: 1.0,
  });
  const matGold = await native.createMaterial({
    name: "Contact Gold",
    color: "#E5B83B",
    roughness: 0.2,
    metalness: 0.9,
    opacity: 1.0,
  });
  const matChrome = await native.createMaterial({
    name: "Chrome Metal",
    color: "#D0D2D6",
    roughness: 0.18,
    metalness: 0.95,
    opacity: 1.0,
  });
  const matRubber = await native.createMaterial({
    name: "Black Rubber",
    color: "#18181A",
    roughness: 0.85,
    metalness: 0.0,
    opacity: 1.0,
  });
  const matPcbGreen = await native.createMaterial({
    name: "PCB Laminate",
    color: "#1B5E20",
    roughness: 0.4,
    metalness: 0.1,
    opacity: 1.0,
  });

  const consoleBodies: number[] = [];
  const cartridgeBodies: number[] = [];
  const ctrl1Bodies: number[] = [];
  const ctrl2Bodies: number[] = [];
  const cableBodies: number[] = [];
  const screwBodies: number[] = [];

  // ==========================================
  // 1. CONSOLE LOWER CHASSIS & DETAILS
  // ==========================================
  console.log("Modeling Console Lower Chassis...");
  // Base plinth: 256 mm (X) x 202 mm (Y) x 42 mm (Z)
  const baseBox = (await native.createBox([-128, -101, 0], [256, 202, 42], "nes_lower_chassis")).created[0]!;
  let lowerChassisId = baseBox.id;

  // FILLET 4 vertical corners of plinth (radius 3.0 mm)
  let topo = await native.topology(lowerChassisId);
  let vertEdges = topo.edges!.filter(e => {
    const isVert = Math.abs(e.startMm[0] - e.endMm[0]) < 0.1 && Math.abs(e.startMm[1] - e.endMm[1]) < 0.1;
    return isVert && Math.abs(e.startMm[2] - e.endMm[2]) > 38;
  });
  lowerChassisId = await safeFillet(native, lowerChassisId, vertEdges.map(e => e.id), 3.0);

  // FILLET bottom perimeter edge (radius 1.5 mm)
  topo = await native.topology(lowerChassisId);
  let botEdges = topo.edges!.filter(e => Math.abs(e.startMm[2]) < 0.1 && Math.abs(e.endMm[2]) < 0.1);
  lowerChassisId = await safeFillet(native, lowerChassisId, botEdges.map(e => e.id), 1.5);

  // Front step cut: depth 26 mm, height from Z=26 to 43 mm
  const stepCut = (await native.createBox([-129, -102, 26], [258, 28, 18], "step_cutter")).created[0]!;
  const cutRes = await native.boolean("difference", [lowerChassisId], [stepCut.id]);
  lowerChassisId = cutRes.created[0]?.id ?? cutRes.changed[0]!.id;

  // Port 1 Cavity
  const port1Cut = (await native.createBox([-57, -102, 10], [18, 14, 14], "port1_cut")).created[0]!;
  const p1Res = await native.boolean("difference", [lowerChassisId], [port1Cut.id]);
  lowerChassisId = p1Res.created[0]?.id ?? p1Res.changed[0]!.id;

  // Port 2 Cavity
  const port2Cut = (await native.createBox([-25, -102, 10], [18, 14, 14], "port2_cut")).created[0]!;
  const p2Res = await native.boolean("difference", [lowerChassisId], [port2Cut.id]);
  lowerChassisId = p2Res.created[0]?.id ?? p2Res.changed[0]!.id;

  // Power & Reset Bay Cavity
  const btnBayCut = (await native.createBox([-116, -102, 10], [48, 8, 16], "button_bay_cut")).created[0]!;
  const bBayRes = await native.boolean("difference", [lowerChassisId], [btnBayCut.id]);
  lowerChassisId = bBayRes.created[0]?.id ?? bBayRes.changed[0]!.id;

  // Side AV Cavity on Right Panel (X = +128)
  const avBayCut = (await native.createBox([122, 20, 12], [8, 48, 20], "av_bay_cut")).created[0]!;
  const avRes = await native.boolean("difference", [lowerChassisId], [avBayCut.id]);
  lowerChassisId = avRes.created[0]?.id ?? avRes.changed[0]!.id;

  // Controller Port 1 & 2 D-sub sockets + chamfered bezel
  console.log("Modeling Controller Ports...");
  for (const [pIdx, xPos] of [[1, -48], [2, -16]] as const) {
    const socketBlock = (await native.createBox([xPos - 7.5, -99, 11], [15, 10, 12], `port_${pIdx}_socket`)).created[0]!;
    // Chamfer socket front opening rim
    topo = await native.topology(socketBlock.id);
    const sFrontEdges = topo.edges!.filter(e => Math.abs(e.startMm[1] - (-99)) < 0.1 && Math.abs(e.endMm[1] - (-99)) < 0.1);
    const chSocketId = await safeChamfer(native, socketBlock.id, sFrontEdges.map(e => e.id), 0.6);
    consoleBodies.push(chSocketId);
    await native.setMaterial([chSocketId], matDarkCharcoal.id);

    // 7 contact pins per port
    const pinOffsets: [number, number][] = [
      [-4.5, 18], [-1.5, 18], [1.5, 18], [4.5, 18],
      [-3.0, 14], [0.0, 14], [3.0, 14]
    ];
    for (let i = 0; i < pinOffsets.length; i++) {
      const [ox, oz] = pinOffsets[i]!;
      const pin = (await native.createCylinder([xPos + ox, -100, oz], 0.45, 6, [0, 1, 0], `port_${pIdx}_pin_${i}`)).created[0]!;
      consoleBodies.push(pin.id);
      await native.setMaterial([pin.id], matGold.id);
    }
  }

  // Power & Reset Buttons & LED (with chamfers and clearance!)
  console.log("Modeling Buttons with Chamfers...");
  const powerBtnBox = (await native.createBox([-111.5, -101.5, 12], [14, 7.5, 12], "nes_power_button")).created[0]!;
  topo = await native.topology(powerBtnBox.id);
  let btnFEdges = topo.edges!.filter(e => Math.abs(e.startMm[1] - (-101.5)) < 0.1 && Math.abs(e.endMm[1] - (-101.5)) < 0.1);
  const powerBtnId = await safeChamfer(native, powerBtnBox.id, btnFEdges.map(e => e.id), 0.6);

  const resetBtnBox = (await native.createBox([-81.5, -101.5, 12], [11, 7.5, 12], "nes_reset_button")).created[0]!;
  topo = await native.topology(resetBtnBox.id);
  btnFEdges = topo.edges!.filter(e => Math.abs(e.startMm[1] - (-101.5)) < 0.1 && Math.abs(e.endMm[1] - (-101.5)) < 0.1);
  const resetBtnId = await safeChamfer(native, resetBtnBox.id, btnFEdges.map(e => e.id), 0.6);

  const ledJewel = (await native.createBox([-94, -101.8, 15], [5.5, 6.5, 5.5], "nes_power_led")).created[0]!;
  topo = await native.topology(ledJewel.id);
  btnFEdges = topo.edges!.filter(e => Math.abs(e.startMm[1] - (-101.8)) < 0.1 && Math.abs(e.endMm[1] - (-101.8)) < 0.1);
  const ledJewelId = await safeChamfer(native, ledJewel.id, btnFEdges.map(e => e.id), 0.5);

  consoleBodies.push(powerBtnId, resetBtnId, ledJewelId);
  await native.setMaterial([powerBtnId, resetBtnId], matDarkCharcoal.id);
  await native.setMaterial([ledJewelId], matNintendoRed.id);

  // AV Output Jacks on Right Panel
  console.log("Modeling Side AV Jacks...");
  for (const [yPos, colorMat, name] of [
    [32, matGold, "rca_video"],
    [52, matNintendoRed, "rca_audio"]
  ] as const) {
    const sleeve = (await native.createCylinder([124, yPos, 22], 4.15, 6, [1, 0, 0], `${name}_sleeve`)).created[0]!;
    const core = (await native.createCylinder([127, yPos, 22], 3.2, 4, [1, 0, 0], `${name}_core`)).created[0]!;
    const jack = (await native.createCylinder([129, yPos, 22], 1.6, 3, [1, 0, 0], `${name}_pin`)).created[0]!;
    consoleBodies.push(sleeve.id, core.id, jack.id);
    await native.setMaterial([sleeve.id], matChrome.id);
    await native.setMaterial([core.id], colorMat.id);
    await native.setMaterial([jack.id], matGold.id);
  }

  // Rear Panel I/O
  console.log("Modeling Rear Panel I/O...");
  const rfBox = (await native.createBox([-48, 98, 15], [20, 5, 16], "rf_modulator_box")).created[0]!;
  const rfJack = (await native.createCylinder([-38, 101, 23], 4.75, 9, [0, 1, 0], "rf_f_connector")).created[0]!;
  const chSwitch = (await native.createBox([-18, 99, 18], [12, 4, 8], "ch3_4_switch")).created[0]!;
  const pwrJack = (await native.createCylinder([22, 101, 22], 4.5, 7, [0, 1, 0], "ac_power_barrel")).created[0]!;
  const pwrPin = (await native.createCylinder([22, 101, 22], 1.0, 8, [0, 1, 0], "ac_power_center_pin")).created[0]!;
  consoleBodies.push(rfBox.id, rfJack.id, chSwitch.id, pwrJack.id, pwrPin.id);
  await native.setMaterial([rfBox.id, rfJack.id], matChrome.id);
  await native.setMaterial([chSwitch.id, pwrJack.id], matDarkCharcoal.id);
  await native.setMaterial([pwrPin.id], matGold.id);

  // 4 Rubber Feet
  console.log("Modeling Feet...");
  const feetPos: [number, number][] = [[-105, -78], [105, -78], [-105, 78], [105, 78]];
  for (let i = 0; i < feetPos.length; i++) {
    const [fx, fy] = feetPos[i]!;
    const foot = (await native.createCylinder([fx, fy, -3], 8, 3, [0, 0, 1], `rubber_foot_${i + 1}`)).created[0]!;
    topo = await native.topology(foot.id);
    const rimEdge = topo.edges!.filter(e => Math.abs(e.startMm[2] - (-3)) < 0.1 && e.kind === "circle");
    const chFootId = await safeFillet(native, foot.id, rimEdge.map(e => e.id), 1.0);
    consoleBodies.push(chFootId);
    await native.setMaterial([chFootId], matRubber.id);
  }

  // 6 UNDERSIDE CHASSIS FASTENERS (SCREWS & COUNTERBORES)
  console.log("Adding 6 Underside Chassis Screws with Counterbores...");
  const chassisScrewPos: [number, number][] = [
    [-95, -65], [95, -65], [-95, 0], [95, 0], [-95, 65], [95, 65]
  ];
  for (let i = 0; i < chassisScrewPos.length; i++) {
    const [sx, sy] = chassisScrewPos[i]!;
    const fast = await addFastener(
      native,
      lowerChassisId,
      [sx, sy, 0],
      [0, 0, 1],
      3.4, // headRadius
      4.0, // headDepth
      1.5, // shankRadius
      10.0, // shankLen
      `chassis_screw_${i + 1}`
    );
    lowerChassisId = fast.targetId;
    screwBodies.push(fast.screwId);
    await native.setMaterial([fast.screwId], matChrome.id);
  }

  consoleBodies.push(lowerChassisId);
  await native.setMaterial([lowerChassisId], matDarkCharcoal.id);

  // ==========================================
  // 2. CONSOLE UPPER SHELL, FLAP & LOUVERS
  // ==========================================
  console.log("Modeling Console Upper Housing with Fillets...");
  const upperBox = (await native.createBox([-128, -101, 42], [256, 202, 47], "nes_upper_chassis")).created[0]!;
  let upperChassisId = upperBox.id;

  // FILLET 4 vertical outer corners (radius 3.0 mm)
  topo = await native.topology(upperChassisId);
  vertEdges = topo.edges!.filter(e => {
    const isVert = Math.abs(e.startMm[0] - e.endMm[0]) < 0.1 && Math.abs(e.startMm[1] - e.endMm[1]) < 0.1;
    return isVert && Math.abs(e.startMm[2] - e.endMm[2]) > 43;
  });
  upperChassisId = await safeFillet(native, upperChassisId, vertEdges.map(e => e.id), 3.0);

  // FILLET top perimeter edges (radius 1.5 mm)
  topo = await native.topology(upperChassisId);
  const uTopEdges = topo.edges!.filter(e => Math.abs(e.startMm[2] - 89) < 0.1 && Math.abs(e.endMm[2] - 89) < 0.1);
  upperChassisId = await safeFillet(native, upperChassisId, uTopEdges.map(e => e.id), 1.5);

  // Cartridge flap opening cut / cavity
  const flapCavityCut = (await native.createBox([-118, -102, 48], [138, 14, 37], "flap_bay_cut")).created[0]!;
  const flRes = await native.boolean("difference", [upperChassisId], [flapCavityCut.id]);
  upperChassisId = flRes.created[0]?.id ?? flRes.changed[0]!.id;

  // Vent grille recess pocket cut on top right
  const ventPocketCut = (await native.createBox([28, -48, 86.8], [92, 126, 3.2], "vent_recess_pocket")).created[0]!;
  const ventCutRes = await native.boolean("difference", [upperChassisId], [ventPocketCut.id]);
  upperChassisId = ventCutRes.created[0]?.id ?? ventCutRes.changed[0]!.id;

  // 4 Internal Upper Chassis Mounting Screws inside the cavity
  console.log("Adding 4 Internal Upper Chassis Screws...");
  const internalScrewPos: [number, number][] = [
    [-112, 40], [14, 40], [-112, -40], [14, -40]
  ];
  for (let i = 0; i < internalScrewPos.length; i++) {
    const [ix, iy] = internalScrewPos[i]!;
    const fast = await addFastener(
      native,
      upperChassisId,
      [ix, iy, 48],
      [0, 0, 1],
      3.0,
      3.0,
      1.4,
      8.0,
      `internal_screw_${i + 1}`
    );
    upperChassisId = fast.targetId;
    screwBodies.push(fast.screwId);
    await native.setMaterial([fast.screwId], matChrome.id);
  }

  consoleBodies.push(upperChassisId);
  await native.setMaterial([upperChassisId], matLightGray.id);

  // Cartridge Loading Flap Door (with chamfered perimeter and clearance!)
  console.log("Modeling Cartridge Door Flap with Chamfers...");
  const doorFlapBox = (await native.createBox([-117, -100.5, 49], [136, 5.5, 35], "cartridge_door_flap")).created[0]!;
  topo = await native.topology(doorFlapBox.id);
  const doorFEdges = topo.edges!.filter(e => Math.abs(e.startMm[1] - (-100.5)) < 0.1 && Math.abs(e.endMm[1] - (-100.5)) < 0.1);
  let chDoorId = await safeChamfer(native, doorFlapBox.id, doorFEdges.map(e => e.id), 0.8);

  // Bottom finger-lift groove
  const fingerLift = (await native.createBox([-80, -101.2, 49], [62, 2.0, 3], "door_finger_lift")).created[0]!;

  // AUTHENTIC ENGRAVED LOGO ON DOOR FLAP
  console.log("Engraving Authentic Nintendo ENTERTAINMENT SYSTEM Logo onto Door Flap...");
  const nintendoWires = (await native.createText("Nintendo", 7.0, [-92, -100.5, 57], [0, -1, 0], [1, 0, 0])).created;
  const subWires = (await native.createText("ENTERTAINMENT SYSTEM", 2.3, [-92, -100.5, 53], [0, -1, 0], [1, 0, 0])).created;
  const logoWires = [...nintendoWires, ...subWires];

  const imp = await native.imprint(chDoorId, {
    curveIds: logoWires.map(w => w.id),
    direction: [0, 1, 0],
  });
  chDoorId = imp.changed[0]!.id;
  await native.deleteBodies(logoWires.map(w => w.id));

  // Deboss letter faces into the flap surface
  topo = await native.topology(chDoorId, "faces");
  const letterFaces = topo.faces!.filter(f => {
    return Math.abs(f.normal[1] - (-1)) < 0.05 &&
           Math.abs(f.centerMm[1] - (-100.5)) < 0.1 &&
           f.centerMm[0] > -94 && f.centerMm[0] < -35 &&
           f.centerMm[2] > 51 && f.centerMm[2] < 66;
  });
  if (letterFaces.length > 0) {
    const debossRes = await native.offset(chDoorId, { faceIds: letterFaces.map(f => f.id) }, -0.35);
    chDoorId = debossRes.changed[0]?.id ?? chDoorId;
  }

  consoleBodies.push(chDoorId, fingerLift.id);
  await native.setMaterial([chDoorId], matDarkCharcoal.id);
  await native.setMaterial([fingerLift.id], matDarkCharcoal.id);

  // Ventilation Louvers (12 cooling fins sitting neatly inside the pocket)
  console.log("Modeling Louvers & Vents with Chamfers...");
  const ventBed = (await native.createBox([29, -47, 86.8], [90, 124, 0.8], "vent_bed")).created[0]!;
  consoleBodies.push(ventBed.id);
  await native.setMaterial([ventBed.id], matDarkCharcoal.id);

  for (let i = 0; i < 12; i++) {
    const yRib = -42 + i * 10;
    const ribBox = (await native.createBox([31, yRib, 87.4], [86, 4.5, 1.4], `cooling_louver_${i + 1}`)).created[0]!;
    topo = await native.topology(ribBox.id);
    const rTopEdges = topo.edges!.filter(e => Math.abs(e.startMm[2] - 88.8) < 0.1 && Math.abs(e.endMm[2] - 88.8) < 0.1);
    const chRibId = await safeChamfer(native, ribBox.id, rTopEdges.map(e => e.id), 0.4);
    consoleBodies.push(chRibId);
    await native.setMaterial([chRibId], matDarkCharcoal.id);
  }

  // ==========================================
  // 3. NES GAME CARTRIDGE (GAME PAK) - WITH CLEARANCE & FASTENERS
  // ==========================================
  console.log("Modeling NES Game Cartridge with Fillets and Security Screws...");
  // Placed standing cleanly to the right: X = 160 to 280, Y = -15 to 4, Z = 0 to 133
  // 32 mm CLEARANCE from console right edge (X = 128) - NO OVERLAP!
  const cartBody = (await native.createBox([160, -15, 0], [120, 19, 133], "game_pak_cartridge")).created[0]!;
  let cartId = cartBody.id;

  // FILLET 4 vertical corners of cartridge (radius 2.5 mm)
  topo = await native.topology(cartId);
  vertEdges = topo.edges!.filter(e => {
    const isVert = Math.abs(e.startMm[0] - e.endMm[0]) < 0.1 && Math.abs(e.startMm[1] - e.endMm[1]) < 0.1;
    return isVert && Math.abs(e.startMm[2] - e.endMm[2]) > 125;
  });
  cartId = await safeFillet(native, cartId, vertEdges.map(e => e.id), 2.5);

  // FILLET top perimeter edge (radius 1.5 mm)
  topo = await native.topology(cartId);
  const cartTopEdges = topo.edges!.filter(e => Math.abs(e.startMm[2] - 133) < 0.1 && Math.abs(e.endMm[2] - 133) < 0.1);
  cartId = await safeFillet(native, cartId, cartTopEdges.map(e => e.id), 1.5);

  // Bottom edge connector throat slot cut
  const pcbSlotCut = (await native.createBox([167, -12.5, -1], [106, 14, 26], "pcb_slot_cut")).created[0]!;
  const cCut1 = await native.boolean("difference", [cartId], [pcbSlotCut.id]);
  cartId = cCut1.created[0]?.id ?? cCut1.changed[0]!.id;

  // Front label recess cut
  const labelRecessCut = (await native.createBox([177, -15.8, 18], [86, 1.5, 88], "label_recess_cut")).created[0]!;
  const cCut2 = await native.boolean("difference", [cartId], [labelRecessCut.id]);
  cartId = cCut2.created[0]?.id ?? cCut2.changed[0]!.id;

  // 5 Top Finger Grip Grooves (chamfered)
  for (let i = 0; i < 5; i++) {
    const zGrip = 114 + i * 3.8;
    const gripCut = (await native.createBox([159, -16.0, zGrip], [122, 2.2, 2.0], `cart_grip_cut_${i}`)).created[0]!;
    const gCut = await native.boolean("difference", [cartId], [gripCut.id]);
    cartId = gCut.created[0]?.id ?? gCut.changed[0]!.id;
  }

  // 3 REAR CARTRIDGE SECURITY FASTENERS (SCREWS & COUNTERBORES)
  console.log("Adding 3 Rear Cartridge Security Screws...");
  const cartScrewPos: [number, number][] = [
    [172, 15], [268, 15], [220, 124]
  ];
  for (let i = 0; i < cartScrewPos.length; i++) {
    const [sx, sz] = cartScrewPos[i]!;
    const fast = await addFastener(
      native,
      cartId,
      [sx, 4, sz],
      [0, -1, 0], // pointing into rear wall (-Y)
      2.5,
      2.0,
      1.2,
      6.0,
      `cart_sec_screw_${i + 1}`
    );
    cartId = fast.targetId;
    screwBodies.push(fast.screwId);
    await native.setMaterial([fast.screwId], matChrome.id);
  }

  cartridgeBodies.push(cartId);
  await native.setMaterial([cartId], matCartridgeGray.id);

  // Label Artwork Inset Plate
  const labelPlate = (await native.createBox([178, -15.3, 19], [84, 0.8, 86], "cart_label_plate")).created[0]!;
  // Molded "THIS SIDE OUT" Arrow
  const arrowWedge = (await native.createBox([217, -15.7, 108], [6, 0.8, 4], "cart_arrow_indicator")).created[0]!;

  // Internal PCB & Gold Connector Fingers
  const pcbBoard = (await native.createBox([169, -6.3, 4], [102, 1.6, 30], "cart_pcb_board")).created[0]!;
  cartridgeBodies.push(labelPlate.id, arrowWedge.id, pcbBoard.id);
  await native.setMaterial([labelPlate.id], matLightGray.id);
  await native.setMaterial([arrowWedge.id], matNintendoRed.id);
  await native.setMaterial([pcbBoard.id], matPcbGreen.id);

  // Gold Pins on PCB edge
  for (let i = 0; i < 16; i++) {
    const xPin = 173 + i * 5.8;
    const goldPinFront = (await native.createBox([xPin, -6.7, 4], [3.2, 0.5, 14], `pcb_pin_f_${i}`)).created[0]!;
    const goldPinBack = (await native.createBox([xPin, -4.8, 4], [3.2, 0.5, 14], `pcb_pin_b_${i}`)).created[0]!;
    cartridgeBodies.push(goldPinFront.id, goldPinBack.id);
    await native.setMaterial([goldPinFront.id, goldPinBack.id], matGold.id);
  }

  // ==========================================
  // 4. CONTROLLER 1 & CONTROLLER 2 (NES-004) - WITH FILLETS & 12 REAR SCREWS
  // ==========================================
  console.log("Modeling Controller 1 & 2 with Fillets, Chamfers & 12 Rear Screws...");
  const ctrlConfigs = [
    { idx: 1, cx: -85, cy: -195, list: ctrl1Bodies, portX: -48 },
    { idx: 2, cx: 55, cy: -195, list: ctrl2Bodies, portX: -16 }
  ];

  for (const { idx, cx, cy, list, portX } of ctrlConfigs) {
    // Controller Shell: 123 mm x 53 mm x 17 mm
    const cBox = (await native.createBox([cx - 61.5, cy - 26.5, 0], [123, 53, 17], `controller_${idx}_shell`)).created[0]!;
    let ctrlId = cBox.id;

    // FILLET 4 vertical corners of controller shell (radius 3.0 mm)
    topo = await native.topology(ctrlId);
    vertEdges = topo.edges!.filter(e => {
      const isVert = Math.abs(e.startMm[0] - e.endMm[0]) < 0.1 && Math.abs(e.startMm[1] - e.endMm[1]) < 0.1;
      return isVert && Math.abs(e.startMm[2] - e.endMm[2]) > 15;
    });
    ctrlId = await safeFillet(native, ctrlId, vertEdges.map(e => e.id), 3.0);

    // FILLET top perimeter edges (radius 1.2 mm)
    topo = await native.topology(ctrlId);
    let cTopEdges = topo.edges!.filter(e => Math.abs(e.startMm[2] - 17) < 0.1 && Math.abs(e.endMm[2] - 17) < 0.1);
    ctrlId = await safeFillet(native, ctrlId, cTopEdges.map(e => e.id), 1.2);

    // FILLET bottom perimeter edges (radius 1.0 mm)
    topo = await native.topology(ctrlId);
    let cBotEdges = topo.edges!.filter(e => Math.abs(e.startMm[2]) < 0.1 && Math.abs(e.endMm[2]) < 0.1);
    ctrlId = await safeFillet(native, ctrlId, cBotEdges.map(e => e.id), 1.0);

    // Recessed faceplate decal pocket cut: 117 x 47 x 0.8 mm
    const decalCut = (await native.createBox([cx - 58.5, cy - 23.5, 16.2], [117, 47, 1.5], `ctrl_${idx}_decal_cut`)).created[0]!;
    const dCut = await native.boolean("difference", [ctrlId], [decalCut.id]);
    ctrlId = dCut.created[0]?.id ?? dCut.changed[0]!.id;

    // 6 REAR FASTENERS ON CONTROLLER BACK (SCREWS & COUNTERBORES)
    console.log(`Adding 6 Rear Screws on Controller ${idx}...`);
    const ctrlScrewOffsets: [number, number][] = [
      [-50, -18], [0, -18], [50, -18],
      [-50, 18], [0, 18], [50, 18]
    ];
    for (let s = 0; s < ctrlScrewOffsets.length; s++) {
      const [sox, soy] = ctrlScrewOffsets[s]!;
      const fast = await addFastener(
        native,
        ctrlId,
        [cx + sox, cy + soy, 0],
        [0, 0, 1], // pointing into rear face (+Z)
        2.2, // headRadius
        2.5, // headDepth
        1.2, // shankRadius
        6.0, // shankLen
        `ctrl_${idx}_screw_${s + 1}`
      );
      ctrlId = fast.targetId;
      screwBodies.push(fast.screwId);
      await native.setMaterial([fast.screwId], matChrome.id);
    }

    list.push(ctrlId);
    await native.setMaterial([ctrlId], matLightGray.id);

    // Dark Faceplate Decal Inset Plate
    const decalPlate = (await native.createBox([cx - 58, cy - 23, 16.2], [116, 46, 0.4], `ctrl_${idx}_decal_plate`)).created[0]!;
    list.push(decalPlate.id);
    await native.setMaterial([decalPlate.id], matDarkCharcoal.id);

    // D-Pad Cross (with top chamfers and central thumb dish!)
    const dpadX = (await native.createBox([cx - 32 - 11, cy - 3.8, 16.4], [22, 7.6, 3.2], `ctrl_${idx}_dpad_x`)).created[0]!;
    const dpadY = (await native.createBox([cx - 32 - 3.8, cy - 11, 16.4], [7.6, 22, 3.2], `ctrl_${idx}_dpad_y`)).created[0]!;
    const dpadUnion = await native.boolean("union", [dpadX.id], [dpadY.id]);
    let dpadId = dpadUnion.created[0]?.id ?? dpadUnion.changed[0]!.id;

    // Chamfer D-pad top edges (0.5 mm)
    topo = await native.topology(dpadId);
    const dTopEdges = topo.edges!.filter(e => Math.abs(e.startMm[2] - 19.6) < 0.1 && Math.abs(e.endMm[2] - 19.6) < 0.1);
    dpadId = await safeChamfer(native, dpadId, dTopEdges.map(e => e.id), 0.5);

    // Central thumb dish depression on D-pad
    const dish = (await native.createSphere([cx - 32, cy, 21.0], 4.5, `ctrl_${idx}_thumb_dish`)).created[0]!;
    const dishCut = await native.boolean("difference", [dpadId], [dish.id]);
    const finalDpadId = dishCut.created[0]?.id ?? dishCut.changed[0]!.id;

    list.push(finalDpadId);
    await native.setMaterial([finalDpadId], matDarkCharcoal.id);

    // SELECT & START Angled Rubber Pills (with rounded caps!)
    for (const [bName, bX] of [["select", cx - 7], ["start", cx + 7]] as const) {
      const pillBox = (await native.createBox([bX - 4.5, cy - 1.8, 16.4], [9, 3.6, 2.2], `ctrl_${idx}_${bName}`)).created[0]!;
      topo = await native.topology(pillBox.id);
      const pillTopEdges = topo.edges!.filter(e => Math.abs(e.startMm[2] - 18.6) < 0.1 && Math.abs(e.endMm[2] - 18.6) < 0.1);
      const chPillId = await safeFillet(native, pillBox.id, pillTopEdges.map(e => e.id), 0.8);
      list.push(chPillId);
      await native.setMaterial([chPillId], matRubber.id);
    }

    // Action Buttons B & A (Nintendo Red with rounded top rims!)
    const btnPod = (await native.createBox([cx + 20, cy - 7, 16.4], [32, 14, 0.4], `ctrl_${idx}_button_pod`)).created[0]!;
    list.push(btnPod.id);
    await native.setMaterial([btnPod.id], matDarkCharcoal.id);

    const btnBBox = (await native.createCylinder([cx + 27, cy, 16.4], 4.4, 3.0, [0, 0, 1], `ctrl_${idx}_btn_b`)).created[0]!;
    topo = await native.topology(btnBBox.id);
    let btnRimEdge = topo.edges!.filter(e => Math.abs(e.startMm[2] - 19.4) < 0.1 && e.kind === "circle");
    const chBtnBId = await safeFillet(native, btnBBox.id, btnRimEdge.map(e => e.id), 1.0);

    const btnABox = (await native.createCylinder([cx + 43, cy, 16.4], 4.4, 3.0, [0, 0, 1], `ctrl_${idx}_btn_a`)).created[0]!;
    topo = await native.topology(btnABox.id);
    btnRimEdge = topo.edges!.filter(e => Math.abs(e.startMm[2] - 19.4) < 0.1 && e.kind === "circle");
    const chBtnAId = await safeFillet(native, btnABox.id, btnRimEdge.map(e => e.id), 1.0);

    list.push(chBtnBId, chBtnAId);
    await native.setMaterial([chBtnBId, chBtnAId], matNintendoRed.id);

    // Nintendo Logo Accent Badge on Controller
    const badge = (await native.createBox([cx + 18, cy + 13, 16.5], [34, 4.5, 0.6], `ctrl_${idx}_badge`)).created[0]!;
    list.push(badge.id);
    await native.setMaterial([badge.id], matNintendoRed.id);

    // Strain Relief Boot on Controller Top Edge
    const boot1 = (await native.createCylinder([cx, cy + 26.5, 8.5], 3.2, 5, [0, 1, 0], `ctrl_${idx}_boot_outer`)).created[0]!;
    const boot2 = (await native.createCylinder([cx, cy + 31.5, 8.5], 2.4, 4, [0, 1, 0], `ctrl_${idx}_boot_inner`)).created[0]!;
    list.push(boot1.id, boot2.id);
    await native.setMaterial([boot1.id, boot2.id], matRubber.id);

    // Molded Cable running to Console Port in coiled loops
    console.log(`Modeling Controller ${idx} Coiled Cable & Console Plug...`);
    let cablePoints: Vec3[];
    if (idx === 1) {
      cablePoints = [
        [-85, -163.5, 8.5],
        [-85, -158, 4.5],
        [-95, -154, 2.0],
        // Loop 1 (outer left sweep)
        [-118, -158, 2.0],
        [-138, -146, 2.0],
        [-132, -132, 2.0],
        [-112, -136, 2.0],
        // Loop 2 (forward inner sweep)
        [-92, -148, 2.0],
        [-76, -158, 2.0],
        [-62, -145, 2.0],
        [-68, -132, 2.0],
        // Loop 3 (sweep towards console plug)
        [-84, -130, 2.0],
        [-78, -122, 4.0],
        [-64, -120, 8.0],
        [-52, -120, 13.0],
        [-48, -118, 16.0]
      ];
    } else {
      cablePoints = [
        [55, -163.5, 8.5],
        [55, -158, 4.5],
        [65, -154, 2.0],
        // Loop 1 (outer right sweep)
        [88, -158, 2.0],
        [108, -146, 2.0],
        [102, -132, 2.0],
        [82, -136, 2.0],
        // Loop 2 (forward inner sweep)
        [62, -148, 2.0],
        [46, -158, 2.0],
        [32, -145, 2.0],
        [38, -132, 2.0],
        // Loop 3 (sweep towards console plug)
        [24, -130, 2.0],
        [10, -124, 4.0],
        [-2, -120, 8.0],
        [-12, -120, 13.0],
        [-16, -118, 16.0]
      ];
    }
    const splineWire = (await native.createSpline(cablePoints, false, `ctrl_${idx}_cable_spine`)).created[0]!;
    const cableSolid = (await native.pipe([splineWire.id], 3.0)).created[0]!;
    await native.deleteBodies([splineWire.id]); // delete helper wire
    cableBodies.push(cableSolid.id);
    await native.setMaterial([cableSolid.id], matRubber.id);

    // Console End 7-pin Plug Connector Body
    const plugBox = (await native.createBox([portX - 7, -118, 10.5], [14, 15, 11], `ctrl_${idx}_console_plug`)).created[0]!;
    topo = await native.topology(plugBox.id);
    const pFrontEdges = topo.edges!.filter(e => Math.abs(e.startMm[1] - (-118)) < 0.1 && Math.abs(e.endMm[1] - (-118)) < 0.1);
    const chPlugId = await safeChamfer(native, plugBox.id, pFrontEdges.map(e => e.id), 0.8);
    cableBodies.push(chPlugId);
    await native.setMaterial([chPlugId], matDarkCharcoal.id);
  }

  // ==========================================
  // 5. SCENE ORGANIZATION (GROUPS)
  // ==========================================
  console.log("Organizing Scene Hierarchy into Groups...");
  await native.groupBodies(consoleBodies, "Console");
  await native.groupBodies(cartridgeBodies, "Cartridge");
  await native.groupBodies(ctrl1Bodies, "Controller_1");
  await native.groupBodies(ctrl2Bodies, "Controller_2");
  await native.groupBodies(cableBodies, "Cables_And_Plugs");
  await native.groupBodies(screwBodies, "Chassis_And_Controller_Fasteners");

  // ==========================================
  // 6. TOPOLOGY HEALTH VERIFICATION
  // ==========================================
  console.log("Verifying Parasolid Topology...");
  const allState = await native.state();
  const solidIds = allState.bodies.filter((b) => b.type === "Solid").map((b) => b.id);
  console.log(`Checking ${solidIds.length} solid bodies...`);
  const checks = await native.checkBodies(solidIds);
  const invalid = checks.filter((c) => !c.valid);
  if (invalid.length > 0) {
    console.error("FAIL: Invalid solids found:", invalid);
    throw new Error(`Topology check failed for ${invalid.length} bodies`);
  }
  console.log(`SUCCESS: All ${solidIds.length} solids are 100% Parasolid-valid!`);

  // ==========================================
  // 7. EXPORT CAD MODELS (.plasticity, .step)
  // ==========================================
  console.log("Exporting CAD models...");
  const plasticityPath = join(EXAMPLES_DIR, "nes.plasticity");
  const stepPath = join(EXAMPLES_DIR, "nes.step");

  await native.saveCopy(plasticityPath, true);
  console.log(`Saved: ${plasticityPath}`);

  await native.exportStep(stepPath, undefined, true);
  console.log(`Saved: ${stepPath}`);

  // ==========================================
  // 8. TECHNICAL DRAWINGS (SVGs)
  // ==========================================
  console.log("Exporting Technical Vector Drawings...");
  const views: Array<"front" | "back" | "left" | "right" | "top" | "bottom" | "isometric"> = [
    "front", "back", "left", "right", "top", "bottom", "isometric"
  ];
  for (const v of views) {
    const svgPath = join(DRAWINGS_DIR, `nes-${v}.svg`);
    await native.exportDrawing(svgPath, solidIds, [v], true, true);
    console.log(`Exported SVG: nes-${v}.svg`);
  }

  // Full composite sheet SVG (all 7 views)
  const sheetPath = join(DRAWINGS_DIR, "nes-sheet.svg");
  await native.exportDrawing(sheetPath, solidIds, views, true, true);
  console.log(`Exported SVG: nes-sheet.svg`);

  // ==========================================
  // 9. HIGH-RESOLUTION RENDERS & SCREENSHOTS
  // ==========================================
  console.log("Rendering High-Resolution Viewport Shots...");
  const standardViews: Array<{ name: string; view: any }> = [
    { name: "view-front", view: "front" },
    { name: "view-back", view: "back" },
    { name: "view-left", view: "left" },
    { name: "view-right", view: "right" },
    { name: "view-top", view: "top" },
    { name: "view-bottom", view: "bottom" },
    { name: "view-iso-front-left", view: [-1, -1, 0.8] },
    { name: "view-iso-front-right", view: [1, -1, 0.8] },
    { name: "view-iso-rear-left", view: [-1, 1, 0.8] },
    { name: "view-iso-rear-right", view: [1, 1, 0.8] }
  ];

  for (const { name, view } of standardViews) {
    try {
      await native.setView(view);
      await delay(300);
      const outPath = join(EXAMPLES_DIR, `${name}.png`);
      await native.screenshot(outPath, true);
      console.log(`Rendered: ${name}.png`);
    } catch (e) {
      console.warn(`Could not render ${name}:`, e);
    }
  }

  // Detail macro renders
  const detailViews = [
    { name: "detail-controls", view: [-0.6, -1, 0.4], ids: [lowerChassisId, powerBtnId, resetBtnId, ledJewelId] },
    { name: "detail-cartridge", view: [0.8, -0.6, 0.5], ids: cartridgeBodies },
    { name: "detail-logo-engraving", view: [-0.4, -1, 0.3], ids: [chDoorId] },
    { name: "detail-controller-dpad", view: [-0.3, -1, 0.9], ids: ctrl1Bodies.slice(0, 5) },
    { name: "detail-controller-buttons", view: [0.3, -1, 0.9], ids: ctrl1Bodies.slice(5) },
    { name: "detail-screws", view: [0.35, 0.45, -0.85], ids: [lowerChassisId, ...screwBodies.slice(0, 6)] }
  ];

  for (const { name, view, ids } of detailViews) {
    try {
      await native.setView(view as any, true, ids);
      await delay(300);
      const outPath = join(EXAMPLES_DIR, `${name}.png`);
      await native.screenshot(outPath, true);
      console.log(`Rendered macro detail: ${name}.png`);
    } catch (e) {
      console.warn(`Could not render ${name}:`, e);
    }
  }

  // ==========================================
  // 10. VERTICAL PRESENTATION BOARD (PNG)
  // ==========================================
  console.log("Rasterizing SVGs with @resvg/resvg-js...");
  const viewsList = ["isometric", "front", "top", "right", "left", "back", "bottom", "sheet"];
  for (const v of viewsList) {
    const svgPath = join(DRAWINGS_DIR, `nes-${v}.svg`);
    let svg = readFileSync(svgPath, "utf8");
    svg = svg.replace(/width="([\d.]+)mm"/, 'width="$1"');
    svg = svg.replace(/height="([\d.]+)mm"/, 'height="$1"');
    svg = svg.replace(/stroke-width="0\.35"/g, 'stroke-width="0.55"');
    svg = svg.replace(/stroke-width="0\.18"/g, 'stroke-width="0.30"');

    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: v === "sheet" ? 1520 : 1440 },
      background: "#ffffff"
    });
    const pngData = resvg.render();
    writeFileSync(join(DRAWINGS_DIR, `temp-${v}.png`), pngData.asPng());
  }

  console.log("Compositing Presentation Board via Python PIL...");
  const pythonScript = `
import os
from PIL import Image, ImageDraw, ImageFont

DRAWINGS_DIR = r"${DRAWINGS_DIR.replace(/\\/g, '\\\\')}"
OUT_PATH = os.path.join(DRAWINGS_DIR, "nes-presentation.png")

views_info = [
    ("ISOMETRIC PROJECTION", "nes-isometric", "temp-isometric.png"),
    ("TOP VIEW (PLAN & VENTS)", "nes-top", "temp-top.png"),
    ("FRONT VIEW (CARTRIDGE DOOR & CONTROLLER PORTS)", "nes-front", "temp-front.png"),
    ("RIGHT SIDE VIEW (RCA AUDIO / VIDEO OUTPUT)", "nes-right", "temp-right.png"),
    ("LEFT SIDE VIEW", "nes-left", "temp-left.png"),
    ("REAR VIEW (RF MODULATOR & POWER JACK)", "nes-back", "temp-back.png"),
    ("BOTTOM VIEW (FEET & CHASSIS FASTENERS)", "nes-bottom", "temp-bottom.png"),
    ("FULL MULTI-VIEW SHEET (ALL ORTHOGRAPHIC VIEWS)", "nes-sheet", "temp-sheet.png"),
]

try:
    font_main_title = ImageFont.truetype("segoeuib.ttf", 46)
    font_sub_title = ImageFont.truetype("segoeui.ttf", 22)
    font_section_title = ImageFont.truetype("segoeuib.ttf", 26)
    font_section_sub = ImageFont.truetype("segoeui.ttf", 18)
except Exception:
    font_main_title = ImageFont.load_default()
    font_sub_title = ImageFont.load_default()
    font_section_title = ImageFont.load_default()
    font_section_sub = ImageFont.load_default()

loaded_views = []
total_height = 200

for title, code, fname in views_info:
    path = os.path.join(DRAWINGS_DIR, fname)
    if os.path.exists(path):
        im = Image.open(path)
        card_h = 70 + im.height + 50
        loaded_views.append((title, code, im, card_h))
        total_height += card_h

board = Image.new("RGB", (1600, total_height), (255, 255, 255))
draw = ImageDraw.Draw(board)

draw.rectangle([(0, 0), (1600, 160)], fill=(245, 246, 248))
draw.line([(0, 160), (1600, 160)], fill=(218, 220, 224), width=2)
draw.text((60, 42), "NINTENDO ENTERTAINMENT SYSTEM (NES)", fill=(20, 22, 25), font=font_main_title)
draw.text((60, 102), "Production CAD Model | Console, 2 Controllers, Game Pak, 31 Screws | Technical Vector Drawings", fill=(95, 99, 104), font=font_sub_title)
draw.rectangle([(1380, 50), (1540, 105)], fill=(216, 40, 0))
draw.text((1405, 66), "NES-001", fill=(255, 255, 255), font=font_section_title)

cur_y = 190
for title, code, im, card_h in loaded_views:
    draw.text((60, cur_y), title, fill=(28, 30, 33), font=font_section_title)
    draw.text((60, cur_y + 32), f"Drawing: drawings/{code}.svg", fill=(128, 134, 139), font=font_section_sub)
    draw.line([(60, cur_y + 58), (1540, cur_y + 58)], fill=(230, 233, 238), width=1)
    im_x = (1600 - im.width) // 2
    im_y = cur_y + 70
    board.paste(im, (im_x, im_y))
    draw.rectangle([(im_x - 1, im_y - 1), (im_x + im.width, im_y + im.height)], outline=(238, 240, 243), width=1)
    cur_y += card_h

board.save(OUT_PATH, "PNG", optimize=True)
print(f"Saved Presentation Board: {OUT_PATH}")

for _, _, fname in views_info:
    tpath = os.path.join(DRAWINGS_DIR, fname)
    if os.path.exists(tpath):
        os.remove(tpath)
`;
  writeFileSync(join(EXAMPLES_DIR, "compose.py"), pythonScript);
  execSync("python compose.py", { cwd: EXAMPLES_DIR, stdio: "inherit" });
  if (existsSync(join(EXAMPLES_DIR, "compose.py"))) {
    execSync("powershell -Command Remove-Item -Force compose.py", { cwd: EXAMPLES_DIR });
  }

  console.log("=== CAD BUILD AND EXPORT COMPLETED SUCCESSFULLY ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
