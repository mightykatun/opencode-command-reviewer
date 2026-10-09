/** Phase 0 only: inert source exported for an isolated compiled-host proof. */
export const historyWorkerProbeSource = String.raw`
const { parentPort } = require('node:worker_threads')
const { Database } = require('bun:sqlite')
let db
parentPort.on('message', ({ id, op, file }) => {
  try {
    let value
    if (op === 'open') {
      db = new Database(file)
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
      value = db.query('PRAGMA journal_mode').get()
    } else if (op === 'commit') {
      db.transaction(() => db.query('INSERT OR REPLACE INTO probe VALUES (1, ?)').run('committed'))()
      value = 'committed'
    } else if (op === 'rollback') {
      try { db.transaction(() => { db.query('UPDATE probe SET value = ?').run('rolled-back'); throw Error('rollback') })() } catch {}
      value = db.query('SELECT value FROM probe WHERE id=1').get()
    } else if (op === 'read') value = db.query('SELECT value FROM probe WHERE id=1').get()
    else if (op === 'stall') { parentPort.postMessage({ id, entered: true }); while (true) {} }
    else if (op === 'close') { db.close(); db = undefined; value = 'closed' }
    else throw Error('Unknown probe operation')
    parentPort.postMessage({ id, value })
  } catch (error) { parentPort.postMessage({ id, error: String(error) }) }
})
parentPort.postMessage({ ready: true, environmentKeys: Object.keys(process.env).length })
`
