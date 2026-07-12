import EventEmitter from 'events'
import {existsSync} from 'fs'
import {dirname, resolve} from 'path'
import argvsplit from 'argv-split'
import {v4 as uuid} from 'uuid'

import {fromDimensions as newBoard} from '@sabaki/go-board'
import {Controller, ControllerStateTracker, Command} from '@sabaki/gtp'

import i18n from '../i18n.js'
import {
  getBoard,
  getRootProperty,
  getSwapColor,
  sgfParseCompressedVertices,
} from './gametree.js'
import {noop, equals, vertexEquals} from './helper.js'
import {parseAnalysis} from './analysis.js'
import HexBoard from './hexboard.js'

const t = i18n.context('EngineSyncer')
const setting = {
  get: (key) => window.sabaki.setting.get(key),
}

const alpha = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'
const quitTimeout = setting.get('gtp.engine_quit_timeout')

// GTP coordinates are letter+number for both Go and Hex, but the two
// disagree on the letter/flip convention (Go's GTP alphabet skips 'I' and
// numbers rows from the bottom; Hex's SGF/GTP coordinates don't skip 'I'
// and number rows from the top -- see HexBoard.parseVertex). Each board
// class already implements its own convention correctly, so delegate to
// whichever board instance is tracking this engine's position.
function parseVertex(coord, engineBoard) {
  if (coord == null || coord === 'resign') return null
  if (coord === 'pass') return [-1, -1]

  return engineBoard.parseVertex(coord)
}

// Hex has no captures, so tracking engine state with a plain GoBoard would
// silently apply Go's capture rules to Hex positions (and lacks
// HexBoard-only methods like getOpeningVertex()).
function newEngineBoard(gameType, width, height) {
  return gameType === 'hex'
    ? HexBoard.fromDimensions(width, height)
    : newBoard(width, height)
}

// Applies the same diagonal reflection Sabaki.swapHex() uses to a HexBoard
// that's tracking engine state, so it stays in sync after a `swap-pieces`
// is sent or replayed. No-op if there's no single opening stone to reflect.
function applyHexSwap(engineBoard) {
  let opening = engineBoard.getOpeningVertex()
  if (opening == null) return engineBoard

  let [ox, oy] = opening
  let reflected = [oy, ox]

  let next = engineBoard.clone()
  next.set(reflected, -1)
  if (!vertexEquals(reflected, opening)) next.set(opening, 0)

  return next
}

export default class EngineSyncer extends EventEmitter {
  constructor(engine) {
    super()

    let {path, args, commands} = engine

    this._busy = false
    this._suspended = true
    this._analysis = null

    this.id = uuid()
    this.engine = engine
    this.commands = []
    this.treePosition = null
    this.gameType = null

    let absolutePath = resolve(path)
    let executePath = existsSync(absolutePath) ? absolutePath : path
    let executeArgs = [...argvsplit(args)]

    // In a Flatpak sandbox, host engine binaries can't be run directly; route
    // them through flatpak-spawn --host, preserving the working directory.
    if (process.env.FLATPAK_ID != null) {
      executeArgs = [
        '--host',
        `--directory=${dirname(absolutePath)}`,
        executePath,
        ...executeArgs,
      ]
      executePath = 'flatpak-spawn'
    }

    this.controller = new Controller(executePath, executeArgs, {
      cwd: dirname(absolutePath),
    })

    this.stateTracker = new ControllerStateTracker(this.controller)

    this.controller.on('started', () => {
      this.treePosition = null
      this.analysis = null

      Promise.all([
        this.controller.sendCommand({name: 'name'}),
        this.controller.sendCommand({name: 'version'}),
        this.controller.sendCommand({name: 'protocol_version'}),
        this.controller
          .sendCommand({name: 'list_commands'})
          .then((response) => {
            this.commands = response.content.split('\n')
          }),
        ...(commands != null && commands.trim() !== ''
          ? commands
              .split(';')
              .filter((x) => x.trim() !== '')
              .map((command) =>
                this.controller.sendCommand(Command.fromString(command)),
              )
          : []),
      ]).catch(noop)
    })

    this.controller.on('stopped', () => {
      this.treePosition = null
      this.analysis = null
    })

    this.controller.on(
      'command-sent',
      async ({command, subscribe, getResponse}) => {
        if (
          command.name.match(/^(lz-)?(genmove_)?analyze$/) != null ||
          command.args.length > 0
        ) {
          // Handle analysis commands

          let sign = command.args[0].toUpperCase() === 'W' ? -1 : 1
          let boardsize = this.stateTracker.state.boardsize || [19, 19]
          let board =
            this.gameType === 'hex'
              ? HexBoard.fromDimensions(...boardsize)
              : newBoard(...boardsize)
          // kata-analyze reports a float winrate; lz-analyze/analyze report an
          // integer in ten-thousandths.
          let winrateFormat = command.name.startsWith('kata')
            ? 'float'
            : 'integer'

          subscribe(({line}) => {
            // Parse analysis info

            if (line.startsWith('info ')) {
              let variations = parseAnalysis(line, board, winrateFormat)
              // Ignore an update with no parseable variations rather than let
              // Math.max(...[]) === -Infinity become a non-finite SBKV.
              if (variations.length === 0) return

              this.analysis = {
                sign,
                variations,
                winrate: Math.max(...variations.map(({winrate}) => winrate)),
                scoreLead: Math.max(
                  ...variations.map(({scoreLead}) =>
                    scoreLead == null ? NaN : scoreLead,
                  ),
                ),
              }
            } else if (line.startsWith('play ')) {
              sign = -sign

              this.analysis = null
              this.treePosition = null
            }
          })
        } else if (this.treePosition != null) {
          // Invalidate treePosition

          let prevHistory = JSON.parse(
            JSON.stringify(this.stateTracker.state.history),
          )

          await getResponse()

          if (!equals(prevHistory, this.stateTracker.state.history)) {
            this.treePosition = null
            this.analysis = null
          }
        }
      },
    )

    // Sync properties

    for (let eventName of [
      'started',
      'stopped',
      'command-sent',
      'response-received',
    ]) {
      this.controller.on(eventName, () => {
        this.busy = this.controller.busy
        this.suspended = this.controller.process == null
      })
    }
  }

  get state() {
    return this.stateTracker.state
  }

  get busy() {
    return this._busy
  }

  set busy(value) {
    if (value !== this._busy) {
      this._busy = value
      this.emit('busy-changed')
    }
  }

  get suspended() {
    return this._suspended
  }

  set suspended(value) {
    if (value !== this._suspended) {
      this._suspended = value
      this.emit('suspended-changed')
    }
  }

  get analysis() {
    return this._analysis
  }

  set analysis(value) {
    if (value !== this._analysis) {
      this._analysis = value
      this.emit('analysis-update')
    }
  }

  start() {
    this.controller.start()
  }

  async stop() {
    await this.controller.stop(quitTimeout)
  }

  async sendAbort() {
    if (this.controller.busy) {
      try {
        await this.controller.sendCommand({name: 'protocol_version'})
      } catch (err) {
        // Best-effort interrupt: callers don't await this, so swallow the
        // rejection when the engine has already stopped.
      }
    }
  }

  async queueCommand(...args) {
    this.sendAbort()
    return await this.stateTracker.queueCommand(...args)
  }

  async sync(tree, id) {
    this.sendAbort()
    let board = getBoard(tree, id)
    this.gameType = board.gameType

    if (!board.isValid()) {
      throw new Error(t('GTP engines don’t support invalid board positions.'))
    } else if (Math.max(board.width, board.height) > alpha.length) {
      throw new Error(
        t(
          (p) =>
            `GTP engines only support board sizes that don’t exceed ${p.length}.`,
          {
            length: alpha.length,
          },
        ),
      )
    }

    let komi = +getRootProperty(tree, 'KM', 0)
    let boardsize = [board.width, board.height]

    // Replay

    let nodeBoard = getBoard(tree, id)
    let engineBoard = newEngineBoard(board.gameType, board.width, board.height)
    let history = []
    let boardSynced = true
    let nodes = [...tree.listNodesVertically(id, -1, {})].reverse()

    for (let node of nodes) {
      let placedHandicapStones = false

      if (
        node.data.AB &&
        node.data.AB.length >= 2 &&
        engineBoard.isEmpty() &&
        (await this.stateTracker.knowsCommand('set_free_handicap'))
      ) {
        // Place handicap stones

        let vertices = []
          .concat(
            ...node.data.AB.map((value) =>
              sgfParseCompressedVertices(board, value),
            ),
          )
          .sort()
        let coords = vertices
          .map((v) => board.stringifyVertex(v))
          .filter((x) => x != null)
          .filter((x, i, arr) => i === 0 || x !== arr[i - 1])

        if (coords.length > 0) {
          history.push({name: 'set_free_handicap', args: coords})

          for (let vertex of vertices) {
            if (engineBoard.get(vertex) !== 0) continue

            engineBoard = engineBoard.makeMove(1, vertex)
          }

          placedHandicapStones = true
        }
      }

      // Hex's swap (pie) rule is encoded as a `W[reflected]` move plus an
      // `AE` that erases Black's opening stone (see Sabaki.swapHex()).
      // GTP can't express a stone removal as an addition, so rather than
      // replay this as ordinary moves (which would desync and force a
      // full rearrangement below), send the standard Hex GTP `swap-pieces`
      // token and mirror the same reflection on our local engineBoard.
      let swapColor = getSwapColor(tree, node.id)

      if (swapColor != null) {
        history.push({name: 'play', args: [swapColor, 'swap-pieces']})
        engineBoard = applyHexSwap(engineBoard)
        continue
      }

      for (let prop of ['B', 'W', 'AB', 'AW']) {
        if (node.data[prop] == null || (placedHandicapStones && prop === 'AB'))
          continue

        let color = prop.slice(-1)
        let sign = color === 'B' ? 1 : -1
        let vertices = [].concat(
          ...node.data[prop].map((value) =>
            sgfParseCompressedVertices(board, value),
          ),
        )

        for (let vertex of vertices) {
          if (engineBoard.has(vertex) && engineBoard.get(vertex) !== 0) continue

          let coord = !engineBoard.has(vertex)
            ? 'pass'
            : board.stringifyVertex(vertex)

          history.push({name: 'play', args: [color, coord]})
          engineBoard = engineBoard.makeMove(sign, vertex)
        }
      }
    }

    if (!equals(engineBoard.signMap, nodeBoard.signMap)) {
      boardSynced = false
    }

    // Incremental rearrangement

    if (!boardSynced) {
      history = [...this.state.history]
      engineBoard = newEngineBoard(board.gameType, board.width, board.height)

      for (let command of this.state.history) {
        if (command.name === 'play') {
          let [color, coord] = command.args

          if (coord.toLowerCase() === 'swap-pieces') {
            engineBoard = applyHexSwap(engineBoard)
            continue
          }

          let sign = color.toUpperCase() === 'B' ? 1 : -1
          engineBoard = engineBoard.makeMove(
            sign,
            parseVertex(coord, engineBoard),
          )
        } else if (command.name === 'set_free_handicap') {
          for (let coord of command.args) {
            engineBoard = engineBoard.makeMove(
              1,
              parseVertex(coord, engineBoard),
            )
          }
        }
      }

      let diff = engineBoard.diff(board).filter((v) => board.get(v) !== 0)

      for (let vertex of diff) {
        let sign = board.get(vertex)
        let color = sign > 0 ? 'B' : 'W'
        let coord = board.stringifyVertex(vertex)

        history.push({name: 'play', args: [color, coord]})
        engineBoard = engineBoard.makeMove(sign, vertex)
      }

      if (equals(engineBoard.signMap, board.signMap)) {
        boardSynced = true
      }
    }

    // Complete rearrangement

    if (!boardSynced) {
      history = []
      engineBoard = newEngineBoard(board.gameType, board.width, board.height)

      for (let x = 0; x < board.width; x++) {
        for (let y = 0; y < board.height; y++) {
          let vertex = [x, y]
          let sign = board.get(vertex)
          let color = sign > 0 ? 'B' : 'W'
          if (sign === 0) continue

          history.push({
            name: 'play',
            args: [color, board.stringifyVertex(vertex)],
          })
          engineBoard = engineBoard.makeMove(sign, vertex)
        }
      }

      if (equals(engineBoard.signMap, board.signMap)) {
        boardSynced = true
      }
    }

    if (!boardSynced) {
      throw new Error(
        t('Current board arrangement can’t be recreated on the GTP engine.'),
      )
    }

    try {
      await this.stateTracker.sync({komi, boardsize, history})
    } catch (err) {
      throw new Error(t('GTP engine can’t be synced to current state.'))
    }

    this.treePosition = id
    this.analysis = null
  }
}
