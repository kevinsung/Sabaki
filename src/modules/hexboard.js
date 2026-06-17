// Hex board engine. Mirrors the subset of the @sabaki/go-board interface
// that Sabaki relies on (gametree.getBoard, sabaki.makeMove), but Hex has no
// captures, ko, or suicide: placing a stone on an empty cell is the only
// state change. Adjacency is 6-connected, matching the ShudanHex renderer.
//
// Win convention (matches ShudanHex's colored player edges):
// Black connects the top (y=0) and bottom (y=height-1) edges.
// White connects the left (x=0) and right (x=width-1) edges.

const alpha = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'

function vertexEquals([x1, y1], [x2, y2]) {
  return x1 === x2 && y1 === y2
}

export default class HexBoard {
  constructor(signMap = []) {
    this.signMap = signMap
    this.height = signMap.length
    this.width = this.height === 0 ? 0 : signMap[0].length

    if (signMap.some((row) => row.length !== this.width)) {
      throw new Error('signMap is not well-formed')
    }
  }

  get([x, y]) {
    return this.signMap[y] != null ? this.signMap[y][x] : null
  }

  set([x, y], sign) {
    if (this.has([x, y])) {
      this.signMap[y][x] = sign
    }

    return this
  }

  has([x, y]) {
    return 0 <= x && x < this.width && 0 <= y && y < this.height
  }

  clear() {
    this.signMap = this.signMap.map((row) => row.map((_) => 0))
    return this
  }

  makeMove(sign, vertex) {
    let move = this.clone()
    if (sign === 0 || !this.has(vertex)) return move

    move.set(vertex, sign > 0 ? 1 : -1)

    return move
  }

  analyzeMove(sign, vertex) {
    let pass = sign === 0 || !this.has(vertex)
    let overwrite = !pass && !!this.get(vertex)

    return {pass, overwrite, capturing: false, suicide: false, ko: false}
  }

  // Hex has no captures, but MainView reads capture counts for the
  // sidebar regardless of game type.
  getCaptures() {
    return 0
  }

  setCaptures() {
    return this
  }

  isSquare() {
    return this.width === this.height
  }

  // Returns Black's opening vertex if the board consists of exactly one
  // Black stone and nothing else (i.e. White hasn't moved yet), otherwise
  // null. Used to support Hex's swap (pie) rule.
  getOpeningVertex() {
    let vertex = null
    let blackCount = 0
    let whiteCount = 0

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let sign = this.get([x, y])

        if (sign > 0) {
          blackCount++
          vertex = [x, y]
        } else if (sign < 0) {
          whiteCount++
        }
      }
    }

    return blackCount === 1 && whiteCount === 0 ? vertex : null
  }

  isEmpty() {
    return this.signMap.every((row) => row.every((x) => !x))
  }

  getNeighbors(vertex) {
    if (!this.has(vertex)) return []

    let [x, y] = vertex
    return [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
      [x + 1, y - 1],
      [x - 1, y + 1],
    ].filter((v) => this.has(v))
  }

  getConnectedComponent(vertex, predicate, result = null) {
    if (!this.has(vertex)) return []
    if (!result) result = [vertex]

    for (let v of this.getNeighbors(vertex)) {
      if (!predicate(v)) continue
      if (result.some((w) => vertexEquals(w, v))) continue

      result.push(v)
      this.getConnectedComponent(v, predicate, result)
    }

    return result
  }

  getChain(vertex) {
    let sign = this.get(vertex)
    return this.getConnectedComponent(vertex, (v) => this.get(v) === sign)
  }

  // Hex has no scoring phase, but the same-colored group a vertex belongs
  // to is still meaningful to callers that lump getChain/getRelatedChains
  // together (e.g. dead-stone marking).
  getRelatedChains(vertex) {
    return this.getChain(vertex)
  }

  // Hex stones are never removed, so every position is trivially valid.
  isValid() {
    return true
  }

  // Hex has no handicap stones.
  getHandicapPlacement() {
    return []
  }

  clone() {
    return new HexBoard(this.signMap.map((row) => [...row]))
  }

  diff(board) {
    if (board.width !== this.width || board.height !== this.height) {
      return null
    }

    let result = []

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        let sign = board.get([x, y])
        if (this.get([x, y]) === sign) continue

        result.push([x, y])
      }
    }

    return result
  }

  // Hex rows are numbered with row 1 at the top, the opposite of Go's row 1
  // at the bottom, matching the board labels drawn by Goban.

  stringifyVertex(vertex) {
    if (!this.has(vertex)) return ''
    return alpha[vertex[0]] + (vertex[1] + 1)
  }

  parseVertex(coord) {
    if (coord.length < 2) return [-1, -1]

    let x = alpha.indexOf(coord[0].toUpperCase())
    let y = +coord.slice(1) - 1
    let v = [x, y]

    return this.has(v) ? v : [-1, -1]
  }

  // Returns 1 if Black has connected top to bottom, -1 if White has
  // connected left to right, or 0 if neither has won yet.
  getWinner() {
    for (let sign of [1, -1]) {
      let seeds = []

      if (sign === 1) {
        for (let x = 0; x < this.width; x++) {
          if (this.get([x, 0]) === 1) seeds.push([x, 0])
        }
      } else {
        for (let y = 0; y < this.height; y++) {
          if (this.get([0, y]) === -1) seeds.push([0, y])
        }
      }

      let visited = {}
      let queue = [...seeds]
      seeds.forEach((v) => (visited[v] = true))

      while (queue.length > 0) {
        let vertex = queue.shift()
        let [x, y] = vertex

        if (sign === 1 && y === this.height - 1) return 1
        if (sign === -1 && x === this.width - 1) return -1

        for (let n of this.getNeighbors(vertex)) {
          if (this.get(n) !== sign) continue
          if (visited[n]) continue

          visited[n] = true
          queue.push(n)
        }
      }
    }

    return 0
  }

  // Returns the vertices of the chain that connects a player's two edges
  // (the winning group), or [] if nobody has won.
  getWinningChain() {
    for (let sign of [1, -1]) {
      let seeds = []

      if (sign === 1) {
        for (let x = 0; x < this.width; x++) {
          if (this.get([x, 0]) === 1) seeds.push([x, 0])
        }
      } else {
        for (let y = 0; y < this.height; y++) {
          if (this.get([0, y]) === -1) seeds.push([0, y])
        }
      }

      for (let seed of seeds) {
        let chain = this.getChain(seed)
        let touchesEnd = chain.some(([x, y]) =>
          sign === 1 ? y === this.height - 1 : x === this.width - 1,
        )

        if (touchesEnd) return chain
      }
    }

    return []
  }
}

HexBoard.fromDimensions = (width, height = null) => {
  if (height == null) height = width

  let signMap = [...Array(height)].map((_) => Array(width).fill(0))

  return new HexBoard(signMap)
}
