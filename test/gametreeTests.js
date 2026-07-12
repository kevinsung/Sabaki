import assert from 'assert'
import HexBoard from '../src/modules/hexboard.js'
import * as gametree from '../src/modules/gametree.js'

describe('gametree', () => {
  describe('getBoard', () => {
    it('builds a Go board by default', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'SZ', ['9'])
      })

      let board = gametree.getBoard(tree, tree.root.id)

      assert.equal(board.gameType, 'go')
      assert(!(board instanceof HexBoard))
      assert.equal(board.width, 9)
      assert.equal(board.height, 9)
    })

    it('builds a HexBoard when GM[11] is set', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['11'])
      })

      let board = gametree.getBoard(tree, tree.root.id)

      assert.equal(board.gameType, 'hex')
      assert(board instanceof HexBoard)
      assert.equal(board.width, 11)
      assert.equal(board.height, 11)
    })

    it('replays B/W moves on a Hex board without captures', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['5'])

        // 'C3' and 'C2' are Hex SGF (letter+number) for vertices [2,2] and
        // [2,1].
        let id = draft.appendNode(draft.root.id, {B: ['C3']})
        draft.appendNode(id, {W: ['C2']})
      })

      let leafId = [...tree.listNodes()].slice(-1)[0].id
      let board = gametree.getBoard(tree, leafId)

      assert.equal(board.get([2, 2]), 1)
      assert.equal(board.get([2, 1]), -1)
    })

    it('parses column letters case-insensitively, per the Hex SGF spec', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['5'])
        draft.appendNode(draft.root.id, {B: ['c3']})
      })

      let leafId = [...tree.listNodes()].slice(-1)[0].id
      let board = gametree.getBoard(tree, leafId)

      assert.equal(board.get([2, 2]), 1)
    })

    it('marks Black’s lone opening stone with an "S" label on a square Hex board', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['5'])
        // 'B4' is Hex SGF for vertex [1,3].
        draft.appendNode(draft.root.id, {B: ['B4']})
      })

      let leafId = [...tree.listNodes()].slice(-1)[0].id
      let board = gametree.getBoard(tree, leafId)

      assert.deepEqual(board.markers[3][1], {type: 'label', label: 'S'})
    })

    it('does not mark the opening stone once White has replied', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['5'])

        let id = draft.appendNode(draft.root.id, {B: ['B4']})
        draft.appendNode(id, {W: ['A1']})
      })

      let leafId = [...tree.listNodes()].slice(-1)[0].id
      let board = gametree.getBoard(tree, leafId)

      assert.equal(board.markers[3][1], null)
    })

    it('does not mark the opening stone on a rectangular Hex board', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['7:4'])
        // 'B2' is Hex SGF for vertex [1,1].
        draft.appendNode(draft.root.id, {B: ['B2']})
      })

      let leafId = [...tree.listNodes()].slice(-1)[0].id
      let board = gametree.getBoard(tree, leafId)

      // The stone keeps its ordinary last-move marker, not the "S" label.
      assert.deepEqual(board.markers[1][1], {type: 'point'})
    })

    it('reads the literal "swap-pieces" keyword by reflecting and recoloring the board', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['5'])

        let id = draft.appendNode(draft.root.id, {B: ['B4']})
        draft.appendNode(id, {W: ['swap-pieces']})
      })

      let leafId = [...tree.listNodes()].slice(-1)[0].id
      let board = gametree.getBoard(tree, leafId)

      assert.equal(board.get([3, 1]), -1)
      assert.equal(board.get([1, 3]), 0)
    })

    it('places no stone for pass/resign/forfeit keywords', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['5'])

        let id = draft.appendNode(draft.root.id, {B: ['B4']})
        draft.appendNode(id, {W: ['resign']})
      })

      let leafId = [...tree.listNodes()].slice(-1)[0].id
      let board = gametree.getBoard(tree, leafId)

      assert(board.signMap.every((row) => row.every((s) => s !== -1)))
    })
  })

  describe('getSwapColor', () => {
    it('detects an off-diagonal swap node (reflection + AE erasing the opening)', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['5'])

        let openingId = draft.appendNode(draft.root.id, {B: ['B4']})
        draft.appendNode(openingId, {W: ['D2'], AE: ['B4']})
      })

      let swapId = [...tree.listNodes()].slice(-1)[0].id

      assert.equal(gametree.getSwapColor(tree, swapId), 'W')
    })

    it('detects a swap node on the main diagonal, where no AE is needed', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['5'])

        let openingId = draft.appendNode(draft.root.id, {B: ['C3']})
        draft.appendNode(openingId, {W: ['C3']})
      })

      let swapId = [...tree.listNodes()].slice(-1)[0].id

      assert.equal(gametree.getSwapColor(tree, swapId), 'W')
    })

    it('detects the literal "swap-pieces" keyword', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['5'])

        let openingId = draft.appendNode(draft.root.id, {B: ['B4']})
        draft.appendNode(openingId, {W: ['swap-pieces']})
      })

      let swapId = [...tree.listNodes()].slice(-1)[0].id

      assert.equal(gametree.getSwapColor(tree, swapId), 'W')
    })

    it('returns null for an ordinary move', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['5'])

        let openingId = draft.appendNode(draft.root.id, {B: ['B4']})
        draft.appendNode(openingId, {W: ['A1']})
      })

      let leafId = [...tree.listNodes()].slice(-1)[0].id

      assert.equal(gametree.getSwapColor(tree, leafId), null)
    })

    it('returns null when AE doesn’t match the opening stone', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['5'])

        let openingId = draft.appendNode(draft.root.id, {B: ['B4']})
        draft.appendNode(openingId, {W: ['D2'], AE: ['A1']})
      })

      let leafId = [...tree.listNodes()].slice(-1)[0].id

      assert.equal(gametree.getSwapColor(tree, leafId), null)
    })

    it('returns null for a Go board', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'SZ', ['5'])

        let openingId = draft.appendNode(draft.root.id, {B: ['bd']})
        draft.appendNode(openingId, {W: ['db'], AE: ['bd']})
      })

      let leafId = [...tree.listNodes()].slice(-1)[0].id

      assert.equal(gametree.getSwapColor(tree, leafId), null)
    })

    it('returns null on a rectangular Hex board', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['7:4'])

        let openingId = draft.appendNode(draft.root.id, {B: ['B2']})
        draft.appendNode(openingId, {W: ['B2']})
      })

      let leafId = [...tree.listNodes()].slice(-1)[0].id

      assert.equal(gametree.getSwapColor(tree, leafId), null)
    })

    it('returns null for the root node', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['5'])
      })

      assert.equal(gametree.getSwapColor(tree, tree.root.id), null)
    })
  })

  describe('setGameInfo', () => {
    it('writes GM[11] for gameType "hex"', () => {
      let tree = gametree.new()
      let newTree = gametree.setGameInfo(tree, {gameType: 'hex'})

      assert.equal(newTree.root.data.GM[0], '11')
    })

    it('writes GM[1] for gameType "go"', () => {
      let tree = gametree.new()
      let newTree = gametree.setGameInfo(tree, {gameType: 'go'})

      assert.equal(newTree.root.data.GM[0], '1')
    })

    it('strips handicap/AB when game type is hex', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['11'])
      })

      let newTree = gametree.setGameInfo(tree, {handicap: 4})

      assert.equal(newTree.root.data.HA, null)
      assert.equal(newTree.root.data.AB, null)
    })
  })
})
