// Coalesce bursts without overlapping work. One trailing run observes changes
// that arrived while the current operation was in flight.
function singleFlight(task) {
  let pending
  return (...args) => {
    if (!pending) pending = Promise.resolve().then(() => task(...args)).finally(() => { pending = null })
    return pending
  }
}

function serialTask(task) {
  let queue = Promise.resolve()
  return (...args) => {
    const next = queue.then(() => task(...args))
    queue = next.catch(() => {})
    return next
  }
}

module.exports = { singleFlight, serialTask }
