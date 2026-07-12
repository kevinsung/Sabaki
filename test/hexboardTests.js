import assert from 'assert'
import HexBoard from '../src/modules/hexboard.js'

describe('hexboard', () => {
  describe('fromDimensions', () => {
    it('creates an empty signMap of the given size', () => {
      let board = HexBoard.fromDimensions(11)

      assert.equal(board.width, 11)
      assert.equal(board.height, 11)
      assert(board.isEmpty())
    })

    it('creates a rectangular board when width and height differ', () => {
      let board = HexBoard.fromDimensions(7, 4)

      assert.equal(board.width, 7)
      assert.equal(board.height, 4)
      assert(board.isEmpty())
    })
  })

  describe('makeMove', () => {
    it('places a stone without removing anything', () => {
      let board = HexBoard.fromDimensions(5)
      board = board.makeMove(1, [2, 2])
      board = board.makeMove(-1, [2, 1])
      board = board.makeMove(1, [2, 3])
      board = board.makeMove(-1, [2, 4])

      assert.equal(board.get([2, 2]), 1)
      assert.equal(board.get([2, 1]), -1)
      assert.equal(board.get([2, 3]), 1)
      assert.equal(board.get([2, 4]), -1)
    })

    it('does not mutate the original board', () => {
      let board = HexBoard.fromDimensions(5)
      let next = board.makeMove(1, [0, 0])

      assert.equal(board.get([0, 0]), 0)
      assert.equal(next.get([0, 0]), 1)
    })
  })

  describe('analyzeMove', () => {
    it('never reports capturing, suicide, ko, or pass for a vertex on the board', () => {
      let board = HexBoard.fromDimensions(5)
      let result = board.analyzeMove(1, [0, 0])

      assert.deepEqual(result, {
        pass: false,
        overwrite: false,
        capturing: false,
        suicide: false,
        ko: false,
      })
    })

    it('reports overwrite when the vertex is occupied', () => {
      let board = HexBoard.fromDimensions(5).makeMove(1, [0, 0])
      let result = board.analyzeMove(-1, [0, 0])

      assert.equal(result.overwrite, true)
    })
  })

  describe('getNeighbors', () => {
    it('returns the 6 hex-adjacent vertices that are on the board', () => {
      let board = HexBoard.fromDimensions(5)
      let neighbors = board.getNeighbors([2, 2])

      assert.deepEqual(
        neighbors.sort(),
        [
          [1, 2],
          [3, 2],
          [2, 1],
          [2, 3],
          [3, 1],
          [1, 3],
        ].sort(),
      )
    })

    it('clips neighbors that fall off the board', () => {
      let board = HexBoard.fromDimensions(5)
      let neighbors = board.getNeighbors([0, 0])

      assert.deepEqual(
        neighbors.sort(),
        [
          [1, 0],
          [0, 1],
        ].sort(),
      )
    })
  })

  describe('getWinner', () => {
    it('returns 0 when no one has connected their edges', () => {
      let board = HexBoard.fromDimensions(5)
      board = board.makeMove(1, [2, 2])

      assert.equal(board.getWinner(), 0)
    })

    it('returns 1 when Black connects top to bottom via a straight column', () => {
      let board = HexBoard.fromDimensions(5)

      for (let y = 0; y < 5; y++) {
        board = board.makeMove(1, [2, y])
      }

      assert.equal(board.getWinner(), 1)
    })

    it('returns 1 when Black connects top to bottom via a diagonal bridge', () => {
      let board = HexBoard.fromDimensions(5)
      // (x+1, y-1) is a hex neighbor, so a staircase connects too
      let path = [
        [0, 4],
        [1, 3],
        [2, 2],
        [3, 1],
        [4, 0],
      ]

      for (let v of path) board = board.makeMove(1, v)

      assert.equal(board.getWinner(), 1)
    })

    it('returns -1 when White connects left to right', () => {
      let board = HexBoard.fromDimensions(5)

      for (let x = 0; x < 5; x++) {
        board = board.makeMove(-1, [x, 2])
      }

      assert.equal(board.getWinner(), -1)
    })

    it('does not declare a win for a disconnected chain that merely touches both edges separately', () => {
      let board = HexBoard.fromDimensions(5)
      board = board.makeMove(1, [0, 0])
      board = board.makeMove(1, [0, 4])

      assert.equal(board.getWinner(), 0)
    })

    it('returns 1 when Black connects top to bottom on a rectangular board', () => {
      let board = HexBoard.fromDimensions(7, 4)

      for (let y = 0; y < 4; y++) {
        board = board.makeMove(1, [2, y])
      }

      assert.equal(board.getWinner(), 1)
    })

    it('returns -1 when White connects left to right on a rectangular board', () => {
      let board = HexBoard.fromDimensions(7, 4)

      for (let x = 0; x < 7; x++) {
        board = board.makeMove(-1, [x, 2])
      }

      assert.equal(board.getWinner(), -1)
    })
  })

  describe('getWinningChain', () => {
    it('returns [] when no one has connected their edges', () => {
      let board = HexBoard.fromDimensions(5)
      board = board.makeMove(1, [2, 2])

      assert.deepEqual(board.getWinningChain(), [])
    })

    it('returns the connecting chain when Black connects top to bottom', () => {
      let board = HexBoard.fromDimensions(5)
      let path = [
        [2, 0],
        [2, 1],
        [2, 2],
        [2, 3],
        [2, 4],
      ]

      for (let v of path) board = board.makeMove(1, v)

      assert.deepEqual(board.getWinningChain().sort(), path.sort())
    })

    it('returns the connecting chain when White connects left to right', () => {
      let board = HexBoard.fromDimensions(5)
      let path = [
        [0, 2],
        [1, 2],
        [2, 2],
        [3, 2],
        [4, 2],
      ]

      for (let v of path) board = board.makeMove(-1, v)

      assert.deepEqual(board.getWinningChain().sort(), path.sort())
    })

    it('returns the full connected group, including branches off the winning path', () => {
      let board = HexBoard.fromDimensions(5)
      let path = [
        [2, 0],
        [2, 1],
        [2, 2],
        [2, 3],
        [2, 4],
      ]

      for (let v of path) board = board.makeMove(1, v)
      // a stone attached to the winning chain but not on the minimal path
      board = board.makeMove(1, [1, 1])

      let chain = board.getWinningChain().sort()
      assert.deepEqual(chain, [...path, [1, 1]].sort())
    })

    it('does not return a chain for stones that merely touch both edges separately', () => {
      let board = HexBoard.fromDimensions(5)
      board = board.makeMove(1, [0, 0])
      board = board.makeMove(1, [0, 4])

      assert.deepEqual(board.getWinningChain(), [])
    })
  })

  describe('getOpeningVertex', () => {
    it('returns null on an empty board', () => {
      let board = HexBoard.fromDimensions(5)

      assert.equal(board.getOpeningVertex(), null)
    })

    it('returns the vertex of a lone Black stone', () => {
      let board = HexBoard.fromDimensions(5).makeMove(1, [2, 2])

      assert.deepEqual(board.getOpeningVertex(), [2, 2])
    })

    it('returns null once White has replied', () => {
      let board = HexBoard.fromDimensions(5)
        .makeMove(1, [2, 2])
        .makeMove(-1, [0, 0])

      assert.equal(board.getOpeningVertex(), null)
    })

    it('returns null when Black has played more than once', () => {
      let board = HexBoard.fromDimensions(5)
        .makeMove(1, [2, 2])
        .makeMove(1, [0, 0])

      assert.equal(board.getOpeningVertex(), null)
    })
  })

  describe('stringifyVertex/parseVertex', () => {
    it('round-trips a vertex through human-readable coordinates', () => {
      let board = HexBoard.fromDimensions(11)
      let vertex = [3, 4]
      let coord = board.stringifyVertex(vertex)

      assert.deepEqual(board.parseVertex(coord), vertex)
    })

    it('numbers rows with row 1 at the top, unlike Go', () => {
      let board = HexBoard.fromDimensions(11)

      assert.equal(board.stringifyVertex([3, 4]), 'D5')
      assert.deepEqual(board.parseVertex('D5'), [3, 4])
    })

    it('labels the top-left and bottom-left corners correctly', () => {
      let board = HexBoard.fromDimensions(11)

      assert.equal(board.stringifyVertex([0, 0]), 'A1')
      assert.equal(board.stringifyVertex([0, 10]), 'A11')
      assert.deepEqual(board.parseVertex('A1'), [0, 0])
      assert.deepEqual(board.parseVertex('A11'), [0, 10])
    })

    it('does not skip the letter I, unlike Go board labels', () => {
      let board = HexBoard.fromDimensions(11)

      assert.equal(board.stringifyVertex([8, 0]), 'I1')
      assert.deepEqual(board.parseVertex('I1'), [8, 0])
    })

    it('parses column letters case-insensitively, per the Hex SGF spec', () => {
      let board = HexBoard.fromDimensions(11)

      assert.deepEqual(board.parseVertex('d8'), [3, 7])
    })
  })

  describe('swap', () => {
    it('reflects stones along the long diagonal and inverts their color', () => {
      let board = HexBoard.fromDimensions(5).makeMove(1, [2, 1])
      let swapped = board.swap()

      assert.equal(swapped.get([1, 2]), -1)
      assert.equal(swapped.get([2, 1]), 0)
    })

    it('swaps width and height on a rectangular board', () => {
      let board = HexBoard.fromDimensions(7, 4).makeMove(1, [5, 2])
      let swapped = board.swap()

      assert.equal(swapped.width, 4)
      assert.equal(swapped.height, 7)
      assert.equal(swapped.get([2, 5]), -1)
    })

    it('does not mutate the original board', () => {
      let board = HexBoard.fromDimensions(5).makeMove(1, [2, 1])
      board.swap()

      assert.equal(board.get([2, 1]), 1)
    })
  })

  describe('go-board interface parity', () => {
    // These are unused for actual Hex rules, but MainView, the ASCII board
    // export, MiniGoban thumbnails, and the scoring tool call them on any
    // board regardless of game type.
    it('getCaptures always returns 0 and setCaptures is a no-op', () => {
      let board = HexBoard.fromDimensions(5).makeMove(1, [0, 0])

      assert.equal(board.getCaptures(1), 0)
      assert.equal(
        board.setCaptures(1, (x) => x + 1),
        board,
      )
      assert.equal(board.getCaptures(1), 0)
    })

    it('getHandicapPlacement returns no stones', () => {
      let board = HexBoard.fromDimensions(11)

      assert.deepEqual(board.getHandicapPlacement(9), [])
    })

    it('isValid always returns true', () => {
      let board = HexBoard.fromDimensions(5).makeMove(1, [0, 0])

      assert.equal(board.isValid(), true)
    })

    it('getRelatedChains matches getChain', () => {
      let board = HexBoard.fromDimensions(5)
        .makeMove(1, [0, 0])
        .makeMove(1, [1, 0])

      assert.deepEqual(
        board.getRelatedChains([0, 0]).sort(),
        board.getChain([0, 0]).sort(),
      )
    })
  })
})
