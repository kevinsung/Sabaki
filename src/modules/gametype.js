// SGF GM[] property values (see https://www.red-bean.com/sgf/properties.html#GM)
export const GO = '1'
export const HEX = '11'

export function getGameType(tree) {
  let data = tree.root.data.GM
  let gm = data != null && data[0] !== '' ? data[0].toString() : GO

  return gm === HEX ? 'hex' : 'go'
}
