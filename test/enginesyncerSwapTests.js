import assert from 'assert'
import {createRequire} from 'module'
import GameTree from '@sabaki/immutable-gametree'

import {getId} from '../src/modules/utils.js'

const require = createRequire(import.meta.url)

const enginePath = `${__dirname}/engines/resignEngine.js`

// EngineSyncer reads `window.sabaki.setting.get(...)` at *module load time*
// (for `gtp.engine_quit_timeout`), so the module must be imported
// dynamically, after stubbing `window`, rather than via a static `import`
// (which would be hoisted above the stub).
let EngineSyncer

describe('EngineSyncer swap rule', () => {
  before(async () => {
    // i18n.js also reads through `window.sabaki.setting.get` at load time and
    // expects `app.lang` to be unset (a real value would make it look up a
    // language file by key, e.g. `setting.get('gtp.engine_quit_timeout')`
    // colliding with `app.lang` if `get` returned a constant for every key).
    let settings = {'gtp.engine_quit_timeout': 3000}
    global.window = {sabaki: {setting: {get: (key) => settings[key]}}}

    // helper.js (imported by enginesyncer.js for `noop`/`equals`) registers
    // an `ipcRenderer.on('menu-click', ...)` listener at module load time.
    // Outside Electron, `require('electron')` doesn't provide `ipcRenderer`,
    // so pre-seed the module cache with a stub before anything requires it.
    let electronPath = require.resolve('electron')
    require.cache[electronPath] = {
      id: electronPath,
      filename: electronPath,
      loaded: true,
      exports: {ipcRenderer: {on: () => {}}, ipcMain: {on: () => {}}},
    }
    ;({default: EngineSyncer} = await import('../src/modules/enginesyncer.js'))
  })

  describe('sync', () => {
    it('sends a Hex swap as the GTP `swap-pieces` token, not replayed stones', async function () {
      this.timeout(10000)

      // Off-diagonal swap: Black opens at vertex [1,3] (Hex SGF 'B4'),
      // White's swap reflects it to [3,1] ('D2') and erases 'B4' via AE --
      // exactly what Sabaki.swapHex() produces.
      let tree = new GameTree({getId})
      let openingId, swapId

      tree = tree.mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['5'])

        openingId = draft.appendNode(draft.root.id, {B: ['B4']})
        swapId = draft.appendNode(openingId, {W: ['D2'], AE: ['B4']})
      })

      let engineSyncer = new EngineSyncer({
        path: process.execPath,
        args: enginePath,
      })

      try {
        let playCommands = []
        engineSyncer.controller.on('command-sent', ({command}) => {
          if (command.name === 'play') playCommands.push(command.args)
        })

        await engineSyncer.sync(tree, swapId)

        assert.deepEqual(
          playCommands.map(([color, coord]) => [
            color.toLowerCase(),
            coord.toLowerCase(),
          ]),
          [
            // Black's opening, sent as an ordinary stone in GTP coords
            // (SGF 'B4' is vertex [1,3]; GTP coords are the same
            // letter+number format for Hex, so it's sent unchanged).
            ['b', 'b4'],
            // The swap, sent as the standard Hex GTP token instead of a
            // second ordinary stone (which would require also removing
            // Black's 'b4' -- something GTP can't express as an addition).
            ['w', 'swap-pieces'],
          ],
        )

        // Engine-side board state should already agree with the tree's
        // board after the swap-pieces send, so re-syncing the same position
        // shouldn't need to resend anything (no fallback to a full resync).
        playCommands.length = 0
        await engineSyncer.sync(tree, swapId)

        assert.deepEqual(playCommands, [])
      } finally {
        await engineSyncer.stop()
      }
    })

    it('never sends a `komi` command for Hex games', async function () {
      this.timeout(10000)

      let tree = new GameTree({getId})
      let moveId

      tree = tree.mutate((draft) => {
        draft.updateProperty(draft.root.id, 'GM', ['11'])
        draft.updateProperty(draft.root.id, 'SZ', ['5'])

        moveId = draft.appendNode(draft.root.id, {B: ['B4']})
      })

      let engineSyncer = new EngineSyncer({
        path: process.execPath,
        args: enginePath,
      })

      try {
        let commandNames = []
        engineSyncer.controller.on('command-sent', ({command}) => {
          commandNames.push(command.name)
        })

        await engineSyncer.sync(tree, moveId)

        assert.ok(
          !commandNames.includes('komi'),
          `expected no 'komi' command, got: ${commandNames.join(', ')}`,
        )
      } finally {
        await engineSyncer.stop()
      }
    })

    it('sends a `komi` command for Go games', async function () {
      this.timeout(10000)

      let tree = new GameTree({getId})
      let moveId

      tree = tree.mutate((draft) => {
        draft.updateProperty(draft.root.id, 'SZ', ['5'])
        draft.updateProperty(draft.root.id, 'KM', ['6.5'])

        moveId = draft.appendNode(draft.root.id, {B: ['bb']})
      })

      let engineSyncer = new EngineSyncer({
        path: process.execPath,
        args: enginePath,
      })

      try {
        let commandNames = []
        engineSyncer.controller.on('command-sent', ({command}) => {
          commandNames.push(command.name)
        })

        await engineSyncer.sync(tree, moveId)

        assert.ok(
          commandNames.includes('komi'),
          `expected a 'komi' command, got: ${commandNames.join(', ')}`,
        )
      } finally {
        await engineSyncer.stop()
      }
    })
  })
})
