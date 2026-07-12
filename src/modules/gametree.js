import {fromDimensions} from '@sabaki/go-board'
import GameTree from '@sabaki/immutable-gametree'
import {
  stringifyVertex,
  parseVertex,
  parseCompressedVertices,
} from '@sabaki/sgf'
import {getId, vertexEquals} from './utils.js'
import HexBoard from './hexboard.js'
import {getGameType, GO, HEX} from './gametype.js'

const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// Go SGF property values use a two-letter code (e.g. 'dd') that's distinct
// from the letter+number coordinates used for GTP/display. Hex SGF values
// (https://www.red-bean.com/sgf/hex.html#types) *are* letter+number
// coordinates (e.g. 'd8'), which HexBoard's own parseVertex/stringifyVertex
// already implement, so property-value (de)serialization dispatches on
// board type instead of using the Go-only sgf.parseVertex/stringifyVertex.

export function sgfParseVertex(board, coord) {
  return board instanceof HexBoard
    ? board.parseVertex(coord)
    : parseVertex(coord)
}

export function sgfStringifyVertex(board, vertex) {
  return board instanceof HexBoard
    ? board.stringifyVertex(vertex)
    : stringifyVertex(vertex)
}

export function sgfParseCompressedVertices(board, value) {
  if (!(board instanceof HexBoard)) return parseCompressedVertices(value)

  let colon = value.indexOf(':')
  if (colon < 0) return [board.parseVertex(value)]

  let [v1, v2] = [value.slice(0, colon), value.slice(colon + 1)].map((c) =>
    board.parseVertex(c),
  )
  let vertices = []

  for (let i = Math.min(v1[0], v2[0]); i <= Math.max(v1[0], v2[0]); i++) {
    for (let j = Math.min(v1[1], v2[1]); j <= Math.max(v1[1], v2[1]); j++) {
      vertices.push([i, j])
    }
  }

  return vertices
}

// Recognizes the special Hex move keywords defined by the spec
// (https://www.red-bean.com/sgf/hex.html#types): 'pass', 'resign', and
// 'forfeit' place no stone (already handled gracefully, since parsing them
// as a coordinate yields an out-of-board vertex); 'swap-pieces' mutates the
// whole board and is handled explicitly below. 'swap-sides' only reassigns
// which real-world player is Black/White going forward, a notion Sabaki's
// board model (which ties sign strictly to the B/W property) doesn't
// represent, so it's treated as a no-op move, like pass.
export function isHexSwapPieces(value) {
  return typeof value === 'string' && value.toLowerCase() === 'swap-pieces'
}

let boardCache = {}

function nodeMerger(node, data) {
  if (
    (data.B == null || node.data.B == null || data.B[0] !== node.data.B[0]) &&
    (data.W == null || node.data.W == null || data.W[0] !== node.data.W[0])
  )
    return null

  return {...data, ...node.data}
}

const _new = function (options = {}) {
  return new GameTree({
    ...options,
    getId,
    merger: nodeMerger,
  })
}
export {_new as new}

export function getRootProperty(tree, property, fallback = null) {
  let result = ''
  if (property in tree.root.data) result = tree.root.data[property][0]

  return result === '' ? fallback : result
}

export function getGameInfo(tree) {
  let komi = getRootProperty(tree, 'KM')
  if (komi != null && !isNaN(komi)) komi = +komi
  else komi = null

  let size = getRootProperty(tree, 'SZ')
  if (size == null) {
    size = [19, 19]
  } else {
    let s = size.toString().split(':')
    size = [+s[0], +s[s.length - 1]]
  }

  let handicap = getRootProperty(tree, 'HA', 0)
  handicap = Math.max(1, Math.min(9, Math.round(handicap)))
  if (handicap === 1) handicap = 0

  let playerNames = ['B', 'W'].map(
    (x) => getRootProperty(tree, `P${x}`) || getRootProperty(tree, `${x}T`),
  )

  let playerRanks = ['BR', 'WR'].map((x) => getRootProperty(tree, x))

  return {
    playerNames,
    playerRanks,
    blackName: playerNames[0],
    blackRank: playerRanks[0],
    whiteName: playerNames[1],
    whiteRank: playerRanks[1],
    gameName: getRootProperty(tree, 'GN'),
    eventName: getRootProperty(tree, 'EV'),
    gameComment: getRootProperty(tree, 'GC'),
    date: getRootProperty(tree, 'DT'),
    result: getRootProperty(tree, 'RE'),
    komi,
    handicap,
    size,
    gameType: getGameType(tree),
  }
}

export function setGameInfo(tree, data) {
  let newTree = tree.mutate((draft) => {
    if ('gameType' in data) {
      // Update game type

      draft.updateProperty(draft.root.id, 'GM', [
        data.gameType === 'hex' ? HEX : GO,
      ])
    }

    if ('size' in data) {
      // Update board size

      if (data.size) {
        let value = data.size
        value = value.map((x) =>
          isNaN(x) || !x ? 19 : Math.min(25, Math.max(2, x)),
        )

        if (value[0] === value[1]) value = value[0].toString()
        else value = value.join(':')

        draft.updateProperty(draft.root.id, 'SZ', [value])
      } else {
        draft.removeProperty(draft.root.id, 'SZ')
      }
    }
  })

  return newTree.mutate((draft) => {
    let props = {
      blackName: 'PB',
      blackRank: 'BR',
      whiteName: 'PW',
      whiteRank: 'WR',
      gameName: 'GN',
      eventName: 'EV',
      gameComment: 'GC',
      date: 'DT',
      result: 'RE',
      komi: 'KM',
      handicap: 'HA',
    }

    for (let key in props) {
      if (!(key in data)) continue
      let value = data[key]

      if (value && value.toString() !== '') {
        if (key === 'komi') {
          if (isNaN(value)) value = 0
        } else if (key === 'handicap') {
          // Hex has no notion of handicap stones

          if (getGameType(newTree) !== 'go') {
            draft.removeProperty(draft.root.id, props[key])
            draft.removeProperty(draft.root.id, 'AB')
            continue
          }

          let board = getBoard(newTree, newTree.root.id)
          let stones = board.getHandicapPlacement(+value)

          value = stones.length
          if (value <= 1) {
            draft.removeProperty(draft.root.id, props[key])
            draft.removeProperty(draft.root.id, 'AB')
            continue
          }

          draft.updateProperty(draft.root.id, 'AB', stones.map(stringifyVertex))
        }

        draft.updateProperty(draft.root.id, props[key], [value.toString()])
      } else {
        draft.removeProperty(draft.root.id, props[key])
      }
    }
  })
}

export function getMatrixDict(tree) {
  let matrix = [...Array(tree.getHeight() + 1)].map((_) => [])
  let dict = {}

  let inner = (node, matrix, dict, xshift, yshift) => {
    let sequence = [...tree.getSequence(node.id)]
    let hasCollisions = true

    while (hasCollisions) {
      hasCollisions = false

      for (let y = 0; y <= sequence.length; y++) {
        if (xshift >= matrix[yshift + y].length - (y === sequence.length))
          continue

        hasCollisions = true
        xshift++
        break
      }
    }

    for (let y = 0; y < sequence.length; y++) {
      matrix[yshift + y][xshift] = sequence[y].id
      dict[sequence[y].id] = [xshift, yshift + y]
    }

    let lastSequenceNode = sequence.slice(-1)[0]

    for (let k = 0; k < lastSequenceNode.children.length; k++) {
      let child = lastSequenceNode.children[k]
      inner(child, matrix, dict, xshift + k, yshift + sequence.length)
    }

    return [matrix, dict]
  }

  return inner(tree.root, matrix, dict, 0, 0)
}

export function getMatrixWidth(y, matrix) {
  let keys = [...Array(10)]
    .map((_, i) => i + y - 4)
    .filter((i) => i >= 0 && i < matrix.length)

  let padding = Math.min(
    ...keys.map((i) => {
      for (let j = 0; j < matrix[i].length; j++)
        if (matrix[i][j] != null) return j
      return 0
    }),
  )

  let width = Math.max(...keys.map((i) => matrix[i].length)) - padding

  return [width, padding]
}

export function getBoard(tree, id) {
  let treePositions = []
  let board = null

  for (let node of tree.listNodesVertically(id, -1, {})) {
    if (boardCache[node.id] != null && node.id !== id) {
      board = boardCache[node.id]
      break
    }

    treePositions.unshift(node.id)
  }

  if (!board) {
    let size = [19, 19]

    if (tree.root.data.SZ != null) {
      let value = tree.root.data.SZ[0]

      if (value.includes(':')) size = value.split(':')
      else size = [value, value]

      size = size.map((x) => (isNaN(x) ? 19 : +x))
    }

    board =
      getGameType(tree) === 'hex'
        ? HexBoard.fromDimensions(...size)
        : fromDimensions(...size)
  }

  let inner = (tree, id, baseboard) => {
    let node = tree.get(id)
    let parent = tree.get(node.parentId)
    if (node == null) return null

    let vertex = null
    let board = null

    // Make move

    let propData = {B: 1, W: -1}

    for (let prop in propData) {
      if (node.data[prop] == null) continue

      if (isHexSwapPieces(node.data[prop][0])) {
        // External Hex SGF may encode the pie rule with the literal
        // 'swap-pieces' keyword instead of Sabaki's own reflected-move
        // encoding (see Sabaki.swapHex / getSwapColor below).
        board = baseboard.swap()
        break
      }

      vertex = sgfParseVertex(baseboard, node.data[prop][0])
      board = baseboard.makeMove(propData[prop], vertex)
      board.currentVertex = vertex

      break
    }

    if (!board) board = baseboard.clone()

    // Add markup

    propData = {AW: -1, AE: 0, AB: 1}

    for (let prop in propData) {
      if (node.data[prop] == null) continue

      for (let value of node.data[prop]) {
        for (let vertex of sgfParseCompressedVertices(board, value)) {
          if (!board.has(vertex)) continue
          board.set(vertex, propData[prop])
        }
      }
    }

    Object.assign(board, {
      markers: board.signMap.map((row) => row.map((_) => null)),
      lines: [],
      childrenInfo: [],
      siblingsInfo: [],
    })

    if (vertex != null && board.has(vertex)) {
      let [x, y] = vertex
      board.markers[y][x] = {type: 'point'}
    }

    if (board instanceof HexBoard) {
      for (let [x, y] of board.getWinningChain()) {
        // keep the last-move marker on the most recent stone
        if (board.markers[y][x] != null && board.markers[y][x].type === 'point')
          continue

        board.markers[y][x] = {type: 'circle'}
      }

      // mark Black's opening stone with "S" while the swap (pie) rule is
      // still available, so White can swap by clicking it
      if (node.children.length === 0 && board.isSquare()) {
        let openingVertex = board.getOpeningVertex()

        if (openingVertex != null) {
          let [ox, oy] = openingVertex
          board.markers[oy][ox] = {type: 'label', label: 'S'}
        }
      }
    }

    propData = {CR: 'circle', MA: 'cross', SQ: 'square', TR: 'triangle'}

    for (let prop in propData) {
      if (node.data[prop] == null) continue

      for (let value of node.data[prop]) {
        for (let [x, y] of sgfParseCompressedVertices(board, value)) {
          if (board.markers[y] == null) continue
          board.markers[y][x] = {type: propData[prop]}
        }
      }
    }

    if (node.data.LB != null) {
      for (let composed of node.data.LB) {
        let sep = composed.indexOf(':')
        let point = composed.slice(0, sep)
        let label = composed.slice(sep + 1)
        let [x, y] = sgfParseVertex(board, point)

        if (board.markers[y] == null) continue
        board.markers[y][x] = {type: 'label', label}
      }
    }

    if (node.data.L != null) {
      for (let i = 0; i < node.data.L.length; i++) {
        let point = node.data.L[i]
        let label = alpha[i]
        if (label == null) return
        let [x, y] = sgfParseVertex(board, point)

        if (board.markers[y] == null) continue
        board.markers[y][x] = {type: 'label', label}
      }
    }

    for (let type of ['AR', 'LN']) {
      if (node.data[type] == null) continue

      for (let composed of node.data[type]) {
        let sep = composed.indexOf(':')
        let [v1, v2] = [composed.slice(0, sep), composed.slice(sep + 1)].map(
          (coord) => sgfParseVertex(board, coord),
        )

        board.lines.push({v1, v2, type: type === 'AR' ? 'arrow' : 'line'})
      }
    }

    // Add variation overlays

    let addInfo = (node, list) => {
      let v, sign

      if (node.data.B != null) {
        v = sgfParseVertex(board, node.data.B[0])
        sign = 1
      } else if (node.data.W != null) {
        v = sgfParseVertex(board, node.data.W[0])
        sign = -1
      } else {
        return
      }

      if (!board.has(v)) return

      let type = null

      if (node.data.BM != null) {
        type = 'bad'
      } else if (node.data.DO != null) {
        type = 'doubtful'
      } else if (node.data.IT != null) {
        type = 'interesting'
      } else if (node.data.TE != null) {
        type = 'good'
      }

      list[v] = {sign, type}
    }

    for (let child of node.children) {
      addInfo(child, board.childrenInfo)
    }

    if (parent != null) {
      for (let sibling of parent.children) {
        addInfo(sibling, board.siblingsInfo)
      }
    }

    boardCache[id] = board
    return board
  }

  for (let id of treePositions) {
    board = inner(tree, id, board)
  }

  board.gameType = getGameType(tree)

  return board
}

// Detects a Hex swap (pie) node: either a `W[reflected]` move plus the `AE`
// that erases Black's opening stone (Sabaki's own encoding, produced by
// Sabaki.swapHex()), or the literal `W[swap-pieces]` keyword defined by the
// SGF spec (produced by other Hex tools). Returns the swapping color ('W')
// or null. Used by EngineSyncer to send the GTP `swap-pieces` token instead
// of replaying the position as ordinary stones (which would require
// removing a stone, something GTP can't express incrementally).
export function getSwapColor(tree, id) {
  let node = tree.get(id)
  if (node == null || node.parentId == null) return null

  let parentBoard = getBoard(tree, node.parentId)
  if (!(parentBoard instanceof HexBoard) || !parentBoard.isSquare()) return null

  let opening = parentBoard.getOpeningVertex()
  if (opening == null) return null

  if (node.data.W != null && node.data.W.length === 1) {
    if (isHexSwapPieces(node.data.W[0])) return 'W'
  }

  let [x, y] = opening
  let reflected = [y, x]

  if (node.data.W == null || node.data.W.length !== 1) return null
  if (!vertexEquals(sgfParseVertex(parentBoard, node.data.W[0]), reflected))
    return null

  if (!vertexEquals(reflected, opening)) {
    if (node.data.AE == null || node.data.AE.length !== 1) return null
    if (!vertexEquals(sgfParseVertex(parentBoard, node.data.AE[0]), opening))
      return null
  }

  return 'W'
}

export function clearBoardCache() {
  boardCache = {}
}
