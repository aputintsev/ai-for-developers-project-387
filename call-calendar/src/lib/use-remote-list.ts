import { useEffect, useState } from 'react'

export function useRemoteList<Item>(
  request: (options: RequestInit) => Promise<{ status: number; data: Item[] }>,
) {
  const [items, setItems] = useState<Item[] | 'loading' | 'error'>('loading')

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const { data, status } = await request({ signal: controller.signal })
        if (!controller.signal.aborted) {
          setItems(status === 200 && Array.isArray(data) ? data : 'error')
        }
      } catch {
        if (!controller.signal.aborted) setItems('error')
      }
    }

    void load()
    return () => controller.abort()
  }, [request])

  return [items, setItems] as const
}
