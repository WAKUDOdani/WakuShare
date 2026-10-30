import type { ComponentProps, JSX } from 'react'
import { Button } from '@heroui/react'

/** One action style throughout folder settings; tabs and switches keep their own roles. */
export function ExplorerButton({
  className = '',
  ...props
}: Omit<ComponentProps<typeof Button>, 'size' | 'variant'>): JSX.Element {
  return (
    <Button
      {...props}
      size="sm"
      variant="secondary"
      className={`explorer-action ${props.isIconOnly ? 'explorer-action--icon' : ''} ${className}`}
    />
  )
}
