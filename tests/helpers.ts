import { Page } from '@playwright/test';

/**
 * Wait for the game engine to be running and return the __GAME__ handle.
 */
export async function waitForGame(page: Page) {
  await page.waitForFunction(() => {
    const g = (window as any).__GAME__;
    return g && g.engine && g.engine.getCurrentTick() > 0;
  }, undefined, { timeout: 10_000 });
}

/**
 * Wait until the game tick reaches at least `target`.
 */
export async function waitForTick(page: Page, target: number) {
  await page.waitForFunction(
    (t) => (window as any).__GAME__.engine.getCurrentTick() >= t,
    target,
    { timeout: 30_000 },
  );
}

/**
 * Get all local player units as plain objects.
 */
export async function getPlayerUnits(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__GAME__;
    return g.unitManager.getUnitsForPlayer('0').map((u: any) => ({
      id: u.id,
      type: u.type,
      position: { col: u.position.col, row: u.position.row },
      behaviorState: u.behaviorState,
      lastThought: u.lastThought,
      health: u.health,
      isAlive: u.isAlive(),
      currentCommand: u.currentCommand,
      path: u.path,
    }));
  });
}

/**
 * Get a specific unit by id.
 */
export async function getUnit(page: Page, unitId: string) {
  return page.evaluate((id) => {
    const u = (window as any).__GAME__.unitManager.getUnit(id);
    if (!u) return null;
    return {
      id: u.id,
      type: u.type,
      position: { col: u.position.col, row: u.position.row },
      behaviorState: u.behaviorState,
      lastThought: u.lastThought,
      health: u.health,
      isAlive: u.isAlive(),
      currentCommand: u.currentCommand,
      path: u.path ? u.path.length : 0,
      carryingAmount: u.carryingAmount,
    };
  }, unitId);
}

/**
 * Get the directive assigned to a unit by the StrategicCommander.
 */
export async function getDirective(page: Page, unitId: string) {
  return page.evaluate((id) => {
    const d = (window as any).__GAME__.strategicCommander.getDirective(id);
    if (!d) return null;
    return {
      unitId: d.unitId,
      type: d.type,
      targetPosition: d.targetPosition,
      completed: d.completed,
      reasoning: d.reasoning,
    };
  }, unitId);
}

/**
 * Select units by clicking the canvas at a world position.
 * Converts grid col/row to screen pixels using the camera.
 */
export async function clickGridPosition(page: Page, col: number, row: number, button: 'left' | 'right' = 'left') {
  const pos = await page.evaluate(({ col, row }) => {
    const g = (window as any).__GAME__;
    return g.camera.gridToScreen({ col, row }, g.config.tileSize);
  }, { col, row });

  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not found');

  // Clamp to canvas bounds
  const x = Math.max(0, Math.min(box.width - 1, pos.x));
  const y = Math.max(0, Math.min(box.height - 1, pos.y));

  await canvas.click({ position: { x, y }, button });
}

/**
 * Select a unit by clicking near its position.
 */
export async function selectUnit(page: Page, unitId: string) {
  const unit = await getUnit(page, unitId);
  if (!unit) throw new Error(`Unit ${unitId} not found`);
  await clickGridPosition(page, unit.position.col, unit.position.row);
  // Wait for selection to register
  await page.waitForTimeout(100);
}

/**
 * Box-select all player units near the base.
 */
export async function boxSelectNearBase(page: Page) {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not found');

  // Convert grid area around base (col 1-5, row 1-5) to screen
  const topLeft = await page.evaluate(() => {
    const g = (window as any).__GAME__;
    return g.camera.gridToScreen({ col: 1, row: 1 }, g.config.tileSize);
  });
  const bottomRight = await page.evaluate(() => {
    const g = (window as any).__GAME__;
    return g.camera.gridToScreen({ col: 5, row: 5 }, g.config.tileSize);
  });

  const x1 = Math.max(0, Math.min(box.width - 1, topLeft.x));
  const y1 = Math.max(0, Math.min(box.height - 1, topLeft.y));
  const x2 = Math.max(0, Math.min(box.width - 1, bottomRight.x));
  const y2 = Math.max(0, Math.min(box.height - 1, bottomRight.y));

  // Proper drag: mousedown at start, move slowly, mouseup at end
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 10 });
  await page.mouse.up();

  await page.waitForTimeout(300);
}

/**
 * Issue a text command to selected units via the command input.
 */
export async function issueTextCommand(page: Page, command: string) {
  const input = page.locator('#command-input');
  await input.fill(command);
  await input.press('Enter');
  await page.waitForTimeout(100);
}

/**
 * Get the current game tick.
 */
export async function getTick(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__GAME__.engine.getCurrentTick());
}

/**
 * Get all directives from the StrategicCommander.
 */
export async function getAllDirectives(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__GAME__;
    const units = g.unitManager.getUnitsForPlayer('0');
    const result: any[] = [];
    for (const u of units) {
      const d = g.strategicCommander.getDirective(u.id);
      result.push({
        unitId: u.id,
        directive: d ? { type: d.type, completed: d.completed, reasoning: d.reasoning, targetPosition: d.targetPosition } : null,
      });
    }
    return result;
  });
}

/**
 * Check if the StrategicCommander has received any command.
 */
export async function hasReceivedCommand(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as any).__GAME__.strategicCommander['hasReceivedCommand']);
}

/**
 * Record unit positions at this moment for later comparison.
 */
export async function snapshotPositions(page: Page): Promise<Map<string, { col: number; row: number }>> {
  const units = await getPlayerUnits(page);
  const map = new Map<string, { col: number; row: number }>();
  for (const u of units) {
    map.set(u.id, { col: u.position.col, row: u.position.row });
  }
  return map;
}
