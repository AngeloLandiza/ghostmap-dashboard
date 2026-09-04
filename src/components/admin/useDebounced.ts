import { useEffect, useState } from 'react'

/**
 * Delays a value by `delay` ms. The projection calculator debounces its parameter object
 * (kept in state, so its identity only changes when a control moves) before it becomes a
 * query key, which keeps a dragged slider from firing a request per pixel.
 */
export function useDebounced<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])

  return debounced
}

export default useDebounced
