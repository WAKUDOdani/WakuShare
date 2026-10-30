import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'

/** Spring-animates to its content's height so swapped children (e.g. via
    AnimatePresence popLayout) resize their container smoothly instead of
    snapping. */
export function AnimatedHeight({ children }: { children: ReactNode }): JSX.Element {
  const reducedMotion = useReducedMotion()
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | 'auto'>('auto')

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <motion.div
      data-animated-height
      animate={{ height }}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }}
      className="overflow-hidden"
    >
      {/* flex prevents child margins from collapsing out of the measurement */}
      <div ref={contentRef} className="flex flex-col">
        {children}
      </div>
    </motion.div>
  )
}
