import assert from 'assert'
import sgf from '@sabaki/sgf'
import * as fileformats from '../src/modules/fileformats/index.js'
import * as gametree from '../src/modules/gametree.js'
import * as gametype from '../src/modules/gametype.js'

describe('gametype', () => {
  describe('getGameType', () => {
    it('returns "go" when GM is missing', () => {
      let [tree] = fileformats.sgf.parse('(;FF[4]SZ[19])')

      assert.equal(gametype.getGameType(tree), 'go')
    })

    it('returns "go" for GM[1]', () => {
      let [tree] = fileformats.sgf.parse('(;GM[1]FF[4]SZ[19])')

      assert.equal(gametype.getGameType(tree), 'go')
    })

    it('returns "hex" for GM[11]', () => {
      let [tree] = fileformats.sgf.parse('(;GM[11]FF[4]SZ[11])')

      assert.equal(gametype.getGameType(tree), 'hex')
    })
  })

  describe('SGF round-trip', () => {
    it('preserves GM[11] and moves through stringify/parse', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['11'])

        // 'C3'/'C4' are Hex SGF (letter+number) coordinates, not Go's
        // two-letter code.
        let id = draft.appendNode(draft.root.id, {B: ['C3']})
        draft.appendNode(id, {W: ['C4']})
      })

      let sgfText = sgf.stringify([tree.root])
      let [parsed] = fileformats.sgf.parse(sgfText)

      assert.equal(gametype.getGameType(parsed), 'hex')
      assert.equal(parsed.root.data.GM[0], '11')

      let blackNode = [...parsed.listNodes()].find((node) => node.data.B)
      let whiteNode = [...parsed.listNodes()].find((node) => node.data.W)

      assert.equal(blackNode.data.B[0], 'C3')
      assert.equal(whiteNode.data.W[0], 'C4')
    })

    it('parses an externally authored Hex SGF file (letter+number coords) to the right board position', () => {
      // As produced by e.g. PlayHex; see the untracked hexplorer.sgf sample.
      let text =
        '(;FF[4]AP[PlayHex:1.0.0]GM[11]SZ[11];B[d8];W[h4];B[g4];W[h2];B[j2];W[i3])'
      let [tree] = fileformats.sgf.parse(text)
      let leafId = [...tree.listNodes()].slice(-1)[0].id
      let board = gametree.getBoard(tree, leafId)

      assert.equal(board.gameType, 'hex')
      assert.equal(board.get([3, 7]), 1) // d8
      assert.equal(board.get([7, 3]), -1) // h4
      assert.equal(board.get([6, 3]), 1) // g4
      assert.equal(board.get([7, 1]), -1) // h2
      assert.equal(board.get([9, 1]), 1) // j2
      assert.equal(board.get([8, 2]), -1) // i3 (column 'i' is not skipped)
    })

    it('round-trips a Hex game through save (stringify) and load (parse)', () => {
      let tree = gametree.new().mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['11'])

        let id = draft.appendNode(draft.root.id, {B: ['D8']})
        draft.appendNode(id, {W: ['H4']})
      })

      let sgfText = sgf.stringify([tree.root])
      assert(sgfText.includes('B[D8]'))
      assert(sgfText.includes('W[H4]'))

      let [parsed] = fileformats.sgf.parse(sgfText)
      let leafId = [...parsed.listNodes()].slice(-1)[0].id
      let board = gametree.getBoard(parsed, leafId)

      assert.equal(board.get([3, 7]), 1) // D8
      assert.equal(board.get([7, 3]), -1) // H4
    })
  })
})
