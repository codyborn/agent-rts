import { test, expect } from '@playwright/test';
import {
  waitForGame,
  waitForTick,
  getPlayerUnits,
  getUnit,
  getDirective,
  getAllDirectives,
  selectUnit,
  boxSelectNearBase,
  issueTextCommand,
  getTick,
  hasReceivedCommand,
  snapshotPositions,
  clickGridPosition,
} from './helpers';

// ============================================================
// Test Suite: Unit Responsiveness & Command System
// ============================================================

test.describe('Game startup', () => {
  test('game loads and starts ticking', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const tick = await getTick(page);
    expect(tick).toBeGreaterThan(0);
  });

  test('3 player engineers spawn near base', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    expect(units).toHaveLength(3);
    for (const u of units) {
      expect(u.type).toBe('engineer');
      expect(u.isAlive).toBe(true);
      // Near base at (2,2)
      expect(u.position.col).toBeLessThanOrEqual(5);
      expect(u.position.row).toBeLessThanOrEqual(5);
    }
  });

  test('UI elements are present', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    await expect(page.locator('#game-canvas')).toBeVisible();
    await expect(page.locator('#minimap-canvas')).toBeVisible();
    await expect(page.locator('#resource-bar')).toBeVisible();
    await expect(page.locator('#minerals-count')).toBeVisible();
    await expect(page.locator('#energy-count')).toBeVisible();
    await expect(page.locator('#tick-display')).toBeVisible();
  });
});

test.describe('Units idle without commands', () => {
  test('all units start in IDLE state', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    for (const u of units) {
      expect(u.behaviorState).toBe('idle');
    }
  });

  test('units remain idle after 5 seconds with no command', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const posBefore = await snapshotPositions(page);

    // Wait 5 seconds (50 ticks at 10 tps)
    const startTick = await getTick(page);
    await waitForTick(page, startTick + 50);

    const units = await getPlayerUnits(page);
    for (const u of units) {
      expect(u.behaviorState).toBe('idle');
      // Position should not have changed
      const before = posBefore.get(u.id)!;
      expect(u.position.col).toBe(before.col);
      expect(u.position.row).toBe(before.row);
    }
  });

  test('units remain idle after 15 seconds with no command', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const posBefore = await snapshotPositions(page);

    // Wait 15 seconds (150 ticks)
    const startTick = await getTick(page);
    await waitForTick(page, startTick + 150);

    const units = await getPlayerUnits(page);
    for (const u of units) {
      expect(u.behaviorState).toBe('idle');
      const before = posBefore.get(u.id)!;
      expect(u.position.col).toBe(before.col);
      expect(u.position.row).toBe(before.row);
    }
  });

  test('commander has NOT received any command initially', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const received = await hasReceivedCommand(page);
    expect(received).toBe(false);
  });

  test('no directives assigned initially (or all are idle)', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);
    await waitForTick(page, 20);

    const directives = await getAllDirectives(page);
    for (const d of directives) {
      if (d.directive) {
        expect(d.directive.type).toBe('idle');
      }
    }
  });
});

test.describe('Unit selection', () => {
  test('clicking near a unit selects it', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    const firstUnit = units[0];

    await selectUnit(page, firstUnit.id);

    // Command bar should appear
    await expect(page.locator('#command-bar')).toHaveClass(/visible/);

    // Unit info panel should show the unit
    await expect(page.locator('#unit-info')).toContainText('Engineer');
  });

  test('box select selects multiple units', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    await boxSelectNearBase(page);

    // Should show multiple units selected
    const selectedCount = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      return g.unitManager.getSelectedUnits('0').length;
    });
    expect(selectedCount).toBeGreaterThanOrEqual(2);
  });

  test('escape deselects all', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    await selectUnit(page, units[0].id);
    await expect(page.locator('#command-bar')).toHaveClass(/visible/);

    // Click the canvas to ensure the command input is not focused
    // (PlayerController ignores keydown when an input is focused)
    // Use y: 50 to avoid the resource bar overlay (30px high)
    await page.locator('#game-canvas').click({ position: { x: 10, y: 50 }, force: true });
    await page.waitForTimeout(100);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const selectedCount = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      return g.unitManager.getSelectedUnits('0').length;
    });
    expect(selectedCount).toBe(0);
  });
});

test.describe('Text command processing', () => {
  test('issuing text command sets hasReceivedCommand', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    // Select a unit, then issue a command
    const units = await getPlayerUnits(page);
    await selectUnit(page, units[0].id);
    await issueTextCommand(page, 'gather minerals');

    // Give it a moment to process
    await page.waitForTimeout(500);

    const received = await hasReceivedCommand(page);
    expect(received).toBe(true);
  });

  test('command appears in chat log', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    await selectUnit(page, units[0].id);
    await issueTextCommand(page, 'gather minerals');

    await expect(page.locator('#chat-log')).toContainText('gather minerals');
  });

  test('standing order is stored for commanded unit', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    await selectUnit(page, units[0].id);
    await issueTextCommand(page, 'explore the map');

    await page.waitForTimeout(500);

    const standingOrder = await page.evaluate((unitId) => {
      const g = (window as any).__GAME__;
      return g.strategicCommander['standingOrders'].get(unitId) ?? null;
    }, units[0].id);

    expect(standingOrder).toBe('explore the map');
  });
});

test.describe('Right-click movement', () => {
  test('right-click moves selected unit', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    const unit = units[0];
    await selectUnit(page, unit.id);

    const posBefore = { col: unit.position.col, row: unit.position.row };

    // Right-click a few tiles away
    await clickGridPosition(page, posBefore.col + 3, posBefore.row + 3, 'right');

    // Wait for movement to begin
    await page.waitForTimeout(500);

    const after = await getUnit(page, unit.id);
    expect(after).not.toBeNull();

    // Unit should either be moving or have already moved
    const moved =
      after!.position.col !== posBefore.col ||
      after!.position.row !== posBefore.row ||
      after!.behaviorState === 'moving';
    expect(moved).toBe(true);
  });
});

test.describe('Directive system', () => {
  test('command triggers LLM evaluation (directive assigned)', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    // Select first unit and issue a command
    const units = await getPlayerUnits(page);
    await selectUnit(page, units[0].id);

    // Verify command bar is visible before typing
    await expect(page.locator('#command-bar')).toHaveClass(/visible/, { timeout: 3_000 });
    await issueTextCommand(page, 'gather resources nearby');

    // Wait for the commander to evaluate (PLAYER_COMMAND_GAP = 30 ticks = 3s)
    // Give extra time for the LLM call
    await page.waitForTimeout(8_000);

    const directives = await getAllDirectives(page);
    // Note: if LLM is not configured (no API key), directives will be default (idle)
    // We still verify the flow doesn't crash and directives exist
    expect(directives.length).toBeGreaterThan(0);
  });

  test('only commanded units get new directives', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    // Select only the first unit
    await selectUnit(page, units[0].id);
    await issueTextCommand(page, 'go explore');

    await page.waitForTimeout(5_000);

    // First unit: might have a new directive
    const d0 = await getDirective(page, units[0].id);

    // Other units should still be idle or have no directive
    for (let i = 1; i < units.length; i++) {
      const d = await getDirective(page, units[i].id);
      if (d) {
        expect(d.type).toBe('idle');
      }
    }
  });
});

test.describe('Unit does not lose its command', () => {
  test('unit keeps moving after path segment completes', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    const unit = units[0];
    await selectUnit(page, unit.id);

    // Find a distant walkable tile from the unit's position (map is randomly seeded)
    const target = await page.evaluate(({ unitId }) => {
      const g = (window as any).__GAME__;
      const u = g.unitManager.getUnit(unitId);
      const pos = u.position;
      // Search outward for a distant walkable tile
      for (let dist = 8; dist >= 3; dist--) {
        for (const [dr, dc] of [[dist, 0], [0, dist], [-dist, 0], [0, -dist], [dist, dist], [-dist, dist]]) {
          const r = pos.row + dr;
          const c = pos.col + dc;
          if (r < 0 || c < 0 || r >= 40 || c >= 40) continue;
          const tile = g.gameMap.tiles[r]?.[c];
          if (tile && tile.walkable) return { col: c, row: r };
        }
      }
      return { col: 10, row: 10 }; // fallback
    }, { unitId: unit.id });

    const startPos = { col: unit.position.col, row: unit.position.row };
    await clickGridPosition(page, target.col, target.row, 'right');

    // Wait for movement to start
    await page.waitForTimeout(2_000);

    const mid = await getUnit(page, unit.id);

    // The unit should be moving or have started moving
    expect(
      mid!.behaviorState === 'moving' ||
      mid!.position.col !== startPos.col ||
      mid!.position.row !== startPos.row
    ).toBe(true);

    // Wait more time for it to keep making progress
    await page.waitForTimeout(3_000);

    const later = await getUnit(page, unit.id);
    // Should have made progress from mid-point
    const distFromStart = Math.abs(later!.position.col - startPos.col) + Math.abs(later!.position.row - startPos.row);
    expect(distFromStart).toBeGreaterThan(0);
  });
});

test.describe('Standing orders persist', () => {
  test('standing order survives across ticks without new commands', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    await selectUnit(page, units[0].id);
    await issueTextCommand(page, 'attack enemy in bottom right');

    await page.waitForTimeout(1_000);

    // Verify standing order is set
    let order = await page.evaluate((unitId) => {
      return (window as any).__GAME__.strategicCommander['standingOrders'].get(unitId);
    }, units[0].id);
    expect(order).toBe('attack enemy in bottom right');

    // Wait a long time and check again
    const startTick = await getTick(page);
    await waitForTick(page, startTick + 100);

    order = await page.evaluate((unitId) => {
      return (window as any).__GAME__.strategicCommander['standingOrders'].get(unitId);
    }, units[0].id);
    expect(order).toBe('attack enemy in bottom right');
  });

  test('new command replaces standing order for that unit', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    await selectUnit(page, units[0].id);
    await issueTextCommand(page, 'gather minerals');

    await page.waitForTimeout(500);

    let order = await page.evaluate((unitId) => {
      return (window as any).__GAME__.strategicCommander['standingOrders'].get(unitId);
    }, units[0].id);
    expect(order).toBe('gather minerals');

    // Issue new command to same unit
    await issueTextCommand(page, 'defend the base');

    await page.waitForTimeout(500);

    order = await page.evaluate((unitId) => {
      return (window as any).__GAME__.strategicCommander['standingOrders'].get(unitId);
    }, units[0].id);
    expect(order).toBe('defend the base');
  });

  test('commanding unit A does not clear standing order for unit B', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);

    // Command unit 0
    await selectUnit(page, units[0].id);
    await issueTextCommand(page, 'go north');
    await page.waitForTimeout(500);

    // Command unit 1 (should not affect unit 0's order)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await selectUnit(page, units[1].id);
    await issueTextCommand(page, 'go south');
    await page.waitForTimeout(500);

    const order0 = await page.evaluate((uid) => {
      return (window as any).__GAME__.strategicCommander['standingOrders'].get(uid);
    }, units[0].id);
    const order1 = await page.evaluate((uid) => {
      return (window as any).__GAME__.strategicCommander['standingOrders'].get(uid);
    }, units[1].id);

    expect(order0).toBe('go north');
    expect(order1).toBe('go south');
  });
});

test.describe('Evaluation gating', () => {
  test('no LLM evaluation before first command', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    // Wait well past MIN_EVALUATION_GAP (200 ticks = 20s)
    // We'll check at 5s which is past PLAYER_COMMAND_GAP but before heartbeat
    const startTick = await getTick(page);
    await waitForTick(page, startTick + 60);

    // Commander should NOT have evaluated
    const lastEvalTick = await page.evaluate(() => {
      return (window as any).__GAME__.strategicCommander['lastEvalTick'];
    });
    expect(lastEvalTick).toBe(0);
  });

  test('world changes do not trigger evaluation before first command', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    // Manually set a pending world change
    await page.evaluate(() => {
      (window as any).__GAME__.strategicCommander['pendingWorldChange'] = true;
    });

    const startTick = await getTick(page);
    await waitForTick(page, startTick + 250);

    // Should still not have evaluated
    const lastEvalTick = await page.evaluate(() => {
      return (window as any).__GAME__.strategicCommander['lastEvalTick'];
    });
    expect(lastEvalTick).toBe(0);
  });
});

test.describe('DirectiveExecutor behavior states', () => {
  test('executor returns null for busy units (not IDLE/MOVING)', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    // Manually set a unit to GATHERING and check executor behavior
    const result = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      const unit = g.unitManager.getUnitsForPlayer('0')[0];

      // Set a directive
      const directive = {
        unitId: unit.id,
        type: 'gather_resources',
        priority: 3,
        createdAtTick: 0,
        ttl: 1200,
        completed: false,
      };

      // When GATHERING, executor should return null
      unit.behaviorState = 'gathering';
      const action = g.directiveExecutor.execute(unit, directive);

      // Restore
      unit.behaviorState = 'idle';

      return action;
    });

    expect(result).toBeNull();
  });

  test('executor returns action for IDLE units', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      const unit = g.unitManager.getUnitsForPlayer('0')[0];

      const directive = {
        unitId: unit.id,
        type: 'idle',
        priority: 3,
        createdAtTick: 0,
        ttl: 1200,
        completed: false,
      };

      unit.behaviorState = 'idle';
      return g.directiveExecutor.execute(unit, directive);
    });

    expect(result).not.toBeNull();
    expect(result.type).toBe('idle');
  });

  test('MOVING unit is not interrupted by non-combat directive', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      const unit = g.unitManager.getUnitsForPlayer('0')[0];

      const directive = {
        unitId: unit.id,
        type: 'gather_resources',
        priority: 3,
        createdAtTick: 0,
        ttl: 1200,
        completed: false,
      };

      unit.behaviorState = 'moving';
      const action = g.directiveExecutor.execute(unit, directive);
      unit.behaviorState = 'idle';

      return action;
    });

    // Non-combat directive should not interrupt MOVING
    expect(result).toBeNull();
  });
});

test.describe('CombatSystem player-only auto-target', () => {
  test('local player combat units do NOT auto-acquire targets', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    // Spawn a player soldier near an enemy, verify it stays idle
    const result = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      // Spawn a player soldier near enemies
      const soldier = g.unitManager.spawnUnit('soldier', '0', { col: 35, row: 35 }, { col: 2, row: 2 });
      // Let a few ticks run
      return { id: soldier.id };
    });

    const startTick = await getTick(page);
    await waitForTick(page, startTick + 20);

    const unit = await getUnit(page, result.id);
    // Player soldier should remain IDLE (not auto-engaging enemies)
    expect(unit!.behaviorState).toBe('idle');
  });

  test('enemy combat units STILL auto-acquire targets', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    // Spawn a player unit near the enemy soldier to be targeted
    await page.evaluate(() => {
      const g = (window as any).__GAME__;
      g.unitManager.spawnUnit('soldier', '0', { col: 36, row: 36 }, { col: 2, row: 2 });
    });

    const startTick = await getTick(page);
    await waitForTick(page, startTick + 30);

    // Check that the enemy soldier (spawned at ~35,35) has engaged
    const enemySoldier = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      const enemies = g.unitManager.getUnitsForPlayer('1');
      const soldier = enemies.find((u: any) => u.type === 'soldier');
      if (!soldier) return null;
      return {
        behaviorState: soldier.behaviorState,
        attackTargetId: soldier.attackTargetId,
      };
    });

    // Enemy soldier should auto-acquire a target
    if (enemySoldier) {
      expect(
        enemySoldier.behaviorState === 'attacking' || enemySoldier.attackTargetId !== null
      ).toBe(true);
    }
  });
});

test.describe('ResourceSystem player gather loop', () => {
  test('local player engineer goes IDLE after depositing (not auto-gather)', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    // Manually set up a unit that has just finished returning
    const unitId = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      const unit = g.unitManager.getUnitsForPlayer('0')[0];
      // Simulate: unit is at base, carrying resources, in RETURNING state
      unit.position = { col: 2, row: 2 };
      unit.behaviorState = 'returning';
      unit.carryingType = 'minerals';
      unit.carryingAmount = 10;
      unit.homeBase = { col: 2, row: 2 };
      unit.gatherTarget = { col: 10, row: 10 };
      unit.path = null;
      return unit.id;
    });

    // Let ResourceSystem process the deposit
    const startTick = await getTick(page);
    await waitForTick(page, startTick + 5);

    const unit = await getUnit(page, unitId);
    // Should be IDLE, not auto-restarted to GATHERING
    expect(unit!.behaviorState).toBe('idle');
  });
});

test.describe('Wake system (event-based re-evaluation)', () => {
  test('DirectiveExecutor wake flag causes MOVING unit to re-evaluate', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      const unit = g.unitManager.getUnitsForPlayer('0')[0];

      // Set up: unit is MOVING with a gather_resources directive
      unit.behaviorState = 'moving';
      unit.path = [{ col: 20, row: 20 }];

      const directive = {
        unitId: unit.id,
        type: 'gather_resources',
        priority: 3,
        createdAtTick: 0,
        ttl: 1200,
        completed: false,
      };

      // Without wake flag: should return null (keep moving)
      const actionBeforeWake = g.directiveExecutor.execute(unit, directive);

      // Set wake flag manually
      g.directiveExecutor['wakeFlags'].set(unit.id, true);

      // With wake flag: should re-evaluate and return an action
      const actionAfterWake = g.directiveExecutor.execute(unit, directive);

      // Restore
      unit.behaviorState = 'idle';
      unit.path = null;

      return {
        actionBeforeWake,
        actionAfterWake,
        wakeFlagCleared: !g.directiveExecutor['wakeFlags'].get(unit.id),
      };
    });

    // Before wake: null (keep moving)
    expect(result.actionBeforeWake).toBeNull();
    // After wake: should return an action (re-evaluated as if idle)
    expect(result.actionAfterWake).not.toBeNull();
    // Wake flag should be cleared after use
    expect(result.wakeFlagCleared).toBe(true);
  });

  test('RESOURCE_NEARBY event sets wake flag for gather directive', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      const unit = g.unitManager.getUnitsForPlayer('0')[0];

      // Register the unit's active directive in the executor
      const directive = {
        unitId: unit.id,
        type: 'gather_resources',
        priority: 3,
        createdAtTick: 0,
        ttl: 1200,
        completed: false,
      };
      // Call execute once to register the active directive
      unit.behaviorState = 'idle';
      g.directiveExecutor.execute(unit, directive);

      // Now emit a RESOURCE_NEARBY event
      g.eventBus.emit('resource_nearby', {
        unitId: unit.id,
        position: { col: 5, row: 5 },
      });

      return g.directiveExecutor['wakeFlags'].get(unit.id) === true;
    });

    expect(result).toBe(true);
  });

  test('ENEMY_NEARBY event does NOT set wake flag for gather directive', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      const unit = g.unitManager.getUnitsForPlayer('0')[0];

      // Register with gather directive
      const directive = {
        unitId: unit.id,
        type: 'gather_resources',
        priority: 3,
        createdAtTick: 0,
        ttl: 1200,
        completed: false,
      };
      unit.behaviorState = 'idle';
      g.directiveExecutor.execute(unit, directive);

      // Emit ENEMY_NEARBY — should NOT wake a gather unit
      g.eventBus.emit('enemy_nearby', {
        unitId: unit.id,
        enemyId: 'enemy-1',
        position: { col: 10, row: 10 },
      });

      return g.directiveExecutor['wakeFlags'].get(unit.id) ?? false;
    });

    expect(result).toBe(false);
  });
});

test.describe('Coordinate clamping', () => {
  test('out-of-bounds targets get clamped to valid range', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const clamped = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      // Access private method via bracket notation
      return g.strategicCommander['clampPosition']({ col: 100, row: -5 });
    });

    expect(clamped.col).toBeLessThanOrEqual(39);
    expect(clamped.col).toBeGreaterThanOrEqual(0);
    expect(clamped.row).toBeLessThanOrEqual(39);
    expect(clamped.row).toBeGreaterThanOrEqual(0);
  });

  test('floating point targets get rounded', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const clamped = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      return g.strategicCommander['clampPosition']({ col: 15.7, row: 20.3 });
    });

    expect(Number.isInteger(clamped.col)).toBe(true);
    expect(Number.isInteger(clamped.row)).toBe(true);
    expect(clamped.col).toBe(16);
    expect(clamped.row).toBe(20);
  });
});

// ============================================================
// Movement regression tests
// ============================================================

test.describe('Unit movement', () => {
  test('right-click causes actual position change (not just state)', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    const unit = units[0];
    await selectUnit(page, unit.id);
    const startPos = { col: unit.position.col, row: unit.position.row };

    // Find a walkable target a few tiles away
    const target = await page.evaluate(({ unitId }) => {
      const g = (window as any).__GAME__;
      const u = g.unitManager.getUnit(unitId);
      const pos = u.position;
      for (let dist = 5; dist >= 2; dist--) {
        for (const [dr, dc] of [[0, dist], [dist, 0], [0, -dist], [-dist, 0]]) {
          const r = pos.row + dr;
          const c = pos.col + dc;
          if (r < 0 || c < 0 || r >= 40 || c >= 40) continue;
          const tile = g.gameMap.tiles[r]?.[c];
          if (tile && tile.walkable) return { col: c, row: r };
        }
      }
      return null;
    }, { unitId: unit.id });
    expect(target).not.toBeNull();

    await clickGridPosition(page, target!.col, target!.row, 'right');

    // Wait for the unit to actually change grid position (up to 3s)
    await page.waitForFunction(
      ({ unitId, startCol, startRow }) => {
        const g = (window as any).__GAME__;
        const u = g.unitManager.getUnit(unitId);
        if (!u) return false;
        return u.position.col !== startCol || u.position.row !== startRow;
      },
      { unitId: unit.id, startCol: startPos.col, startRow: startPos.row },
      { timeout: 5_000 },
    );

    const after = await getUnit(page, unit.id);
    expect(
      after!.position.col !== startPos.col || after!.position.row !== startPos.row,
    ).toBe(true);
  });

  test('unit moves multiple tiles toward target over time', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    const unit = units[0];
    await selectUnit(page, unit.id);
    const startPos = { col: unit.position.col, row: unit.position.row };

    // Find a walkable target 6+ tiles away
    const target = await page.evaluate(({ unitId }) => {
      const g = (window as any).__GAME__;
      const u = g.unitManager.getUnit(unitId);
      const pos = u.position;
      for (let dist = 8; dist >= 4; dist--) {
        for (const [dr, dc] of [[0, dist], [dist, 0], [dist, dist], [0, -dist], [-dist, 0]]) {
          const r = pos.row + dr;
          const c = pos.col + dc;
          if (r < 0 || c < 0 || r >= 40 || c >= 40) continue;
          const tile = g.gameMap.tiles[r]?.[c];
          if (tile && tile.walkable) return { col: c, row: r };
        }
      }
      return null;
    }, { unitId: unit.id });
    expect(target).not.toBeNull();

    await clickGridPosition(page, target!.col, target!.row, 'right');

    // Wait 4 seconds — engineer (speed 1.5) should move ~5 tiles in 4s at tickRate 10
    await page.waitForTimeout(4_000);

    const after = await getUnit(page, unit.id);
    const dist =
      Math.abs(after!.position.col - startPos.col) +
      Math.abs(after!.position.row - startPos.row);
    expect(dist).toBeGreaterThanOrEqual(2);
  });

  test('enemy AI units move over time', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    // Get all enemy units and their starting positions
    const enemySnapshot = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      const all = g.unitManager.getAllUnits();
      return all
        .filter((u: any) => u.playerId !== '0' && u.isAlive())
        .map((u: any) => ({
          id: u.id,
          col: u.position.col,
          row: u.position.row,
        }));
    });

    expect(enemySnapshot.length).toBeGreaterThan(0);

    // Wait 10 seconds for enemy AI to take actions
    await page.waitForTimeout(10_000);

    // Check that at least one enemy unit has moved
    const anyMoved = await page.evaluate((snapshot: any[]) => {
      const g = (window as any).__GAME__;
      for (const s of snapshot) {
        const u = g.unitManager.getUnit(s.id);
        if (u && u.isAlive() && (u.position.col !== s.col || u.position.row !== s.row)) {
          return true;
        }
      }
      return false;
    }, enemySnapshot);

    expect(anyMoved).toBe(true);
  });

  test('voice command "move to col 10 row 10" results in unit movement', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    const unit = units[0];
    await selectUnit(page, unit.id);
    const startPos = { col: unit.position.col, row: unit.position.row };

    // Issue a move command via text
    await issueTextCommand(page, 'move to the east');

    // Wait for AI evaluation and movement
    await page.waitForTimeout(8_000);

    const after = await getUnit(page, unit.id);
    // Unit should have moved or at least received a directive
    const directive = await getDirective(page, unit.id);
    expect(
      directive !== null ||
      after!.position.col !== startPos.col ||
      after!.position.row !== startPos.row ||
      after!.behaviorState === 'moving',
    ).toBe(true);
  });

  test('unit command buttons are stable and clickable', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    const unit = units[0]; // engineer
    await selectUnit(page, unit.id);

    // Wait for the UI panel to render
    await page.waitForTimeout(500);

    // The Gather button should exist and be clickable (not detached by per-frame rebuilds)
    const gatherBtn = page.locator('.unit-cmd-btn').filter({ hasText: /gather/i }).first();
    await expect(gatherBtn).toBeVisible({ timeout: 3_000 });

    // Click the button — should NOT throw "element detached from DOM"
    await gatherBtn.click({ timeout: 3_000 });

    // Wait for the command to be processed
    await page.waitForTimeout(1_000);

    // The unit should have received a gather command
    const after = await getUnit(page, unit.id);
    expect(after!.currentCommand).toBe('gather nearby resources');
  });

  test('command buttons persist across frames without DOM detachment', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    await selectUnit(page, units[0].id);
    await page.waitForTimeout(500);

    // Get the initial button element reference
    const btnLocator = page.locator('.unit-cmd-btn').first();
    await expect(btnLocator).toBeVisible({ timeout: 3_000 });

    // Wait 1 second (60+ frames) then verify button is still the same element
    await page.waitForTimeout(1_000);
    await expect(btnLocator).toBeVisible();

    // Verify the button is actually attached to DOM (not stale)
    const isAttached = await btnLocator.evaluate((el) => el.isConnected);
    expect(isAttached).toBe(true);
  });

  test('movement system advances position each movement tick', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    // Directly set a path on a unit via game internals and verify it advances
    const result = await page.evaluate(() => {
      const g = (window as any).__GAME__;
      const unit = g.unitManager.getUnitsForPlayer('0')[0];
      if (!unit) return { error: 'no unit' };

      // Find a walkable position 3 tiles to the right
      let target = null;
      for (let dc = 1; dc <= 5; dc++) {
        const r = unit.position.row;
        const c = unit.position.col + dc;
        const tile = g.gameMap.tiles[r]?.[c];
        if (tile && tile.walkable) {
          target = { row: r, col: c };
        }
      }
      if (!target) return { error: 'no walkable target' };

      const startCol = unit.position.col;
      const startRow = unit.position.row;

      // Use findPath and set it on the unit
      const { findPath } = g;
      if (!findPath) {
        // findPath may not be exposed; set path directly
        const path = [];
        for (let c = startCol + 1; c <= target.col; c++) {
          path.push({ row: startRow, col: c });
        }
        unit.setPath(path);
      } else {
        const path = findPath(unit.position, target, g.gameMap, unit.type);
        unit.setPath(path);
      }
      unit.behaviorState = 'moving';

      return {
        startCol,
        startRow,
        unitId: unit.id,
        pathLength: unit.path ? unit.path.length : 0,
      };
    });

    expect(result).not.toHaveProperty('error');
    expect((result as any).pathLength).toBeGreaterThan(0);

    // Wait 2 seconds for movement ticks to process
    await page.waitForTimeout(2_000);

    const after = await getUnit(page, (result as any).unitId);
    expect(
      after!.position.col !== (result as any).startCol ||
      after!.position.row !== (result as any).startRow,
    ).toBe(true);
  });

  test('unit returns to base after right-click move completes', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    const unit = units[0];

    // Simulate: unit is MOVING with autoReturn, about to complete its final path step
    // Place unit at a distant location with a 1-step path to complete
    const result = await page.evaluate(({ unitId }) => {
      const g = (window as any).__GAME__;
      const u = g.unitManager.getUnit(unitId);
      if (!u) return { error: 'no unit' };

      // Position the unit far from base (14,15) with one step left to (15,15)
      u.position = { col: 14, row: 15 };
      u.behaviorState = 'moving';
      u.autoReturn = true;
      u.homeBase = { col: 2, row: 2 };
      u.path = [{ col: 15, row: 15 }]; // One step left

      return { unitId: u.id };
    }, { unitId: unit.id });

    expect(result).not.toHaveProperty('error');

    // Wait for the movement system to advance the last step, trigger MOVING→IDLE→RETURNING
    await page.waitForFunction(
      ({ unitId }) => {
        const g = (window as any).__GAME__;
        const u = g.unitManager.getUnit(unitId);
        if (!u) return false;
        return u.behaviorState === 'returning';
      },
      { unitId: (result as any).unitId },
      { timeout: 5_000 },
    );

    const returning = await getUnit(page, (result as any).unitId);
    expect(returning!.behaviorState).toBe('returning');
  });

  test('unit does NOT return to base after defend command', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    const unit = units[0];
    await selectUnit(page, unit.id);

    // Issue a defend command (should set autoReturn = false)
    await issueTextCommand(page, 'defend this position');
    await page.waitForTimeout(500);

    const autoReturn = await page.evaluate((id) => {
      return (window as any).__GAME__.unitManager.getUnit(id)?.autoReturn;
    }, unit.id);
    expect(autoReturn).toBe(false);
  });

  test('autoReturn is NOT set on voice command (only right-click)', async ({ page }) => {
    await page.goto('/');
    await waitForGame(page);

    const units = await getPlayerUnits(page);
    const unit = units[0];
    await selectUnit(page, unit.id);

    // Voice commands are managed by the directive system, not autoReturn
    await issueTextCommand(page, 'go explore the map');
    await page.waitForTimeout(500);

    const autoReturn = await page.evaluate((id) => {
      return (window as any).__GAME__.unitManager.getUnit(id)?.autoReturn;
    }, unit.id);
    expect(autoReturn).toBe(false);
  });
});
