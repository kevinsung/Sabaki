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

        let id = draft.appendNode(draft.root.id, {B: ['cc']})
        draft.appendNode(id, {W: ['cd']})
      })

      let sgfText = sgf.stringify([tree.root])
      let [parsed] = fileformats.sgf.parse(sgfText)

      assert.equal(gametype.getGameType(parsed), 'hex')
      assert.equal(parsed.root.data.GM[0], '11')

      let blackNode = [...parsed.listNodes()].find((node) => node.data.B)
      let whiteNode = [...parsed.listNodes()].find((node) => node.data.W)

      assert.equal(blackNode.data.B[0], 'cc')
      assert.equal(whiteNode.data.W[0], 'cd')
    })
  })
})
