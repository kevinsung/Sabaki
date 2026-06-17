const {expect} = require('@playwright/test')
const {test} = require('./fixtures/electron-app')
const {waitForRender} = require('./helpers')

// Exercises the Hex game type end-to-end: creating a new Hex game (the same
// gametree.setGameInfo() code path the Info Drawer's "Game" selector
// drives), rendering via the ShudanHex BoundedHex component, placing
// alternating stones with no captures, the swap (pie) rule on move 2, and
// win detection via top-bottom (Black) / left-right (White) connection.

// @sabaki/sgf encodes vertices as two characters from this alphabet,
// 0-indexed, x then y (e.g. "cb" -> [2, 1]).
const SGF_ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

function decodeSgfVertex(coord) {
  return [SGF_ALPHA.indexOf(coord[0]), SGF_ALPHA.indexOf(coord[1])]
}

async function newHexGame(page, size) {
  await page.evaluate(async (n) => {
    await window.__sabaki.newFile({suppressAskForSave: true})
    window.__sabaki.setGameInfo({gameType: 'hex', size: [n, n]})
  }, size)

  await page.waitForFunction(() => {
    const tree =
      window.__sabaki.state.gameTrees[window.__sabaki.state.gameIndex]
    return tree.root.data.GM != null && tree.root.data.GM[0] === '11'
  })
  await waitForRender(page)
}

async function makeMove(page, vertex) {
  await page.evaluate((v) => window.__sabaki.makeMove(v), vertex)
  await waitForRender(page)
}

function currentNodeData(page) {
  return page.evaluate(() => {
    const {gameTrees, gameIndex, treePosition} = window.__sabaki.state
    const tree = gameTrees[gameIndex]
    return tree.get(treePosition).data
  })
}

test.describe('Hex', () => {
  test('renders the Hex board via ShudanHex', async ({page}) => {
    await newHexGame(page, 11)

    await expect(page.locator('.shudanhex-board')).toBeVisible()

    const vertexCount = await page.locator('.shudanhex-vertex').count()
    expect(vertexCount).toBe(121) // 11x11
  })

  test('places alternating stones without captures', async ({page}) => {
    await newHexGame(page, 5)

    await makeMove(page, [2, 2]) // Black
    await makeMove(page, [2, 1]) // White, adjacent to Black's stone
    await makeMove(page, [2, 3]) // Black

    // Each vertex element gets a shudanhex-sign_X class, and so does the
    // stone-image element nested inside it, so scope to .shudanhex-vertex
    // to count one match per cell.
    const stoneCounts = await page.evaluate(() => ({
      black: document.querySelectorAll('.shudanhex-vertex.shudanhex-sign_1')
        .length,
      white: document.querySelectorAll('.shudanhex-vertex.shudanhex-sign_-1')
        .length,
    }))

    // Hex has no captures: all three stones remain on the board.
    expect(stoneCounts.black).toBe(2)
    expect(stoneCounts.white).toBe(1)
  })

  test('swap rule reflects Black’s opening move into a single White stone', async ({
    page,
  }) => {
    await newHexGame(page, 5)
    await makeMove(page, [1, 3]) // non-diagonal opening (x !== y)

    const canSwap = await page.evaluate(() => window.__sabaki.canSwapHex())
    expect(canSwap).toBe(true)

    await page.evaluate(() => window.__sabaki.swapHex())
    await waitForRender(page)

    const data = await currentNodeData(page)
    expect(data.W).toBeTruthy()
    expect(decodeSgfVertex(data.W[0])).toEqual([3, 1]) // [1,3] reflected

    // The swap leaves exactly one stone on the board: White's, at the
    // reflected vertex. Black's original opening stone is gone.
    const stoneCounts = await page.evaluate(() => ({
      black: document.querySelectorAll('.shudanhex-vertex.shudanhex-sign_1')
        .length,
      white: document.querySelectorAll('.shudanhex-vertex.shudanhex-sign_-1')
        .length,
    }))
    expect(stoneCounts.black).toBe(0)
    expect(stoneCounts.white).toBe(1)

    // Turn order continues normally: Black moves next.
    const currentPlayer = await page.evaluate(() =>
      window.__sabaki.getPlayer(window.__sabaki.state.treePosition),
    )
    expect(currentPlayer).toBe(1)
  })

  test('swap recolors a diagonal opening in place', async ({page}) => {
    await newHexGame(page, 5)
    await makeMove(page, [2, 2]) // on the main diagonal (x === y)

    const canSwap = await page.evaluate(() => window.__sabaki.canSwapHex())
    expect(canSwap).toBe(true)

    await page.evaluate(() => window.__sabaki.swapHex())
    await waitForRender(page)

    // The reflection of a diagonal vertex is itself, so the swap just
    // recolors the existing stone in place: one White stone, no Black.
    const stoneCounts = await page.evaluate(() => ({
      black: document.querySelectorAll('.shudanhex-vertex.shudanhex-sign_1')
        .length,
      white: document.querySelectorAll('.shudanhex-vertex.shudanhex-sign_-1')
        .length,
    }))
    expect(stoneCounts.black).toBe(0)
    expect(stoneCounts.white).toBe(1)

    const hasWhiteOnDiagonal = await page
      .locator('.shudanhex-vertex[data-x="2"][data-y="2"].shudanhex-sign_-1')
      .count()
    expect(hasWhiteOnDiagonal).toBe(1)
  })

  test('marks the opening stone with "S" while swap is available', async ({
    page,
  }) => {
    await newHexGame(page, 5)
    await makeMove(page, [1, 3]) // Black's opening stone

    const markerType = await page.evaluate(
      () => window.__sabaki.board.markers[3][1]?.type,
    )
    expect(markerType).toBe('label')

    const markerLabel = await page
      .locator('.shudanhex-vertex[data-x="1"][data-y="3"] .shudanhex-marker')
      .innerText()
    expect(markerLabel).toBe('S')

    // Once White responds, swap is no longer available and the "S" marker
    // is gone (replaced by the ordinary last-move marker on White's stone).
    await makeMove(page, [0, 0])

    const markerAfterReply = await page.evaluate(
      () => window.__sabaki.board.markers[3][1]?.type ?? null,
    )
    expect(markerAfterReply).toBeNull()
  })

  test('clicking the "S"-marked opening stone swaps it', async ({page}) => {
    await newHexGame(page, 5)
    await makeMove(page, [1, 3]) // non-diagonal opening (x !== y)

    await page.locator('.shudanhex-vertex[data-x="1"][data-y="3"]').click()
    await waitForRender(page)

    const data = await currentNodeData(page)
    expect(data.W).toBeTruthy()
    expect(decodeSgfVertex(data.W[0])).toEqual([3, 1]) // [1,3] reflected

    // Same outcome as calling swapHex() directly: one White stone at the
    // reflected vertex, Black's original opening stone is gone.
    const stoneCounts = await page.evaluate(() => ({
      black: document.querySelectorAll('.shudanhex-vertex.shudanhex-sign_1')
        .length,
      white: document.querySelectorAll('.shudanhex-vertex.shudanhex-sign_-1')
        .length,
    }))
    expect(stoneCounts.black).toBe(0)
    expect(stoneCounts.white).toBe(1)
  })

  test('swap is unavailable on a non-square board', async ({page}) => {
    await page.evaluate(async () => {
      await window.__sabaki.newFile({suppressAskForSave: true})
      window.__sabaki.setGameInfo({gameType: 'hex', size: [7, 4]})
    })
    await page.waitForFunction(() => {
      const tree =
        window.__sabaki.state.gameTrees[window.__sabaki.state.gameIndex]
      return tree.root.data.GM != null && tree.root.data.GM[0] === '11'
    })
    await waitForRender(page)

    await makeMove(page, [1, 1]) // non-diagonal opening

    const canSwap = await page.evaluate(() => window.__sabaki.canSwapHex())
    expect(canSwap).toBe(false)
  })

  test('declares a win when a player connects their edges', async ({page}) => {
    // The electron-app fixture already stubs dialog.showMessageBox, so the
    // win-announcement dialog won't block this test.
    await newHexGame(page, 5)

    // Black connects top (y=0) to bottom (y=4) via a straight column at
    // x=2; White plays harmlessly elsewhere in between.
    const blackColumn = [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
    ]
    const whiteElsewhere = [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ]

    for (let i = 0; i < blackColumn.length; i++) {
      await makeMove(page, blackColumn[i])
      if (i < whiteElsewhere.length) await makeMove(page, whiteElsewhere[i])
    }

    await page.waitForFunction(() => {
      const tree =
        window.__sabaki.state.gameTrees[window.__sabaki.state.gameIndex]
      return tree.root.data.RE != null
    })

    const result = await page.evaluate(() => {
      const tree =
        window.__sabaki.state.gameTrees[window.__sabaki.state.gameIndex]
      return tree.root.data.RE[0]
    })

    expect(result).toBe('B+')
  })

  test('marks the winning connection with circles, leaving the last move as the last-move marker', async ({
    page,
  }) => {
    await newHexGame(page, 5)

    // Same winning column as above: Black connects top to bottom.
    const blackColumn = [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
    ]
    const whiteElsewhere = [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ]

    for (let i = 0; i < blackColumn.length; i++) {
      await makeMove(page, blackColumn[i])
      if (i < whiteElsewhere.length) await makeMove(page, whiteElsewhere[i])
    }

    await page.waitForFunction(() => {
      const tree =
        window.__sabaki.state.gameTrees[window.__sabaki.state.gameIndex]
      return tree.root.data.RE != null
    })

    const markerTypes = await page.evaluate(() =>
      window.__sabaki.board.markers.map((row) =>
        row.map((marker) => (marker == null ? null : marker.type)),
      ),
    )

    // The final move of the winning column, [2, 4], keeps its last-move
    // marker; the rest of the connecting chain is circled.
    for (const [x, y] of blackColumn) {
      const expected = x === 2 && y === 4 ? 'point' : 'circle'
      expect(markerTypes[y][x]).toBe(expected)
    }

    // Stones not part of the winning connection are left unmarked.
    for (const [x, y] of whiteElsewhere) {
      expect(markerTypes[y][x]).toBeNull()
    }
  })

  test('rejects further moves after a player has won', async ({page}) => {
    await newHexGame(page, 5)

    // Same winning column as above: Black connects top to bottom.
    const blackColumn = [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
    ]
    const whiteElsewhere = [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ]

    for (let i = 0; i < blackColumn.length; i++) {
      await makeMove(page, blackColumn[i])
      if (i < whiteElsewhere.length) await makeMove(page, whiteElsewhere[i])
    }

    await page.waitForFunction(() => {
      const tree =
        window.__sabaki.state.gameTrees[window.__sabaki.state.gameIndex]
      return tree.root.data.RE != null
    })

    const treePositionBefore = await page.evaluate(
      () => window.__sabaki.state.treePosition,
    )

    // Try to place another stone on an empty cell after the win.
    await makeMove(page, [4, 4])

    const treePositionAfter = await page.evaluate(
      () => window.__sabaki.state.treePosition,
    )
    expect(treePositionAfter).toEqual(treePositionBefore)

    // The attempted move was rejected, so the target cell remains empty.
    const hasStone = await page
      .locator(
        '.shudanhex-vertex[data-x="4"][data-y="4"].shudanhex-sign_1, ' +
          '.shudanhex-vertex[data-x="4"][data-y="4"].shudanhex-sign_-1',
      )
      .count()
    expect(hasStone).toBe(0)
  })

  test('Info Drawer remembers the last chosen Hex board size when switching game type', async ({
    page,
  }) => {
    // Creating a Hex game persists its size as game.default_hex_board_size
    // (the same setting the Info Drawer should read from).
    await newHexGame(page, 13)

    // Start a fresh (Go) file so the Info Drawer's initial game type is Go,
    // then switch it to Hex in the drawer itself, the same way a user would.
    await page.evaluate(() =>
      window.__sabaki.newFile({suppressAskForSave: true}),
    )
    await page.evaluate(() => window.__sabaki.openDrawer('info'))

    const gameTypeSelect = page.locator('select.game-type')
    await expect(gameTypeSelect).toBeVisible()
    await expect(gameTypeSelect).toHaveValue('go')

    await gameTypeSelect.selectOption('hex')

    // Should reflect the last chosen Hex size (13x13), not the hardcoded
    // 11x11 fallback.
    await expect(page.locator('input[name="size-width"]')).toHaveValue('13')
    await expect(page.locator('input[name="size-height"]')).toHaveValue('13')
  })
})
