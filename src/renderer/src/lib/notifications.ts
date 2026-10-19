import type { ReactNode } from 'react'
import { Toast, ToastQueue } from '@heroui/react'

type Options = NonNullable<Parameters<typeof Toast.toast.success>[1]>
// Several warnings can arrive together. Avoid overlapping browser view transitions
// in HeroUI's default queue, which reject when the next toast interrupts them.
export const queue = new ToastQueue({ wrapUpdate: (update) => update() })
const show = (
  variant: 'success' | 'warning' | 'danger',
  title: ReactNode,
  options?: Options
): string =>
  queue.add(
    { title, variant, description: options?.description, actionProps: options?.actionProps },
    {
      timeout: options?.timeout ?? 5000,
      onClose: options?.onClose
    }
  )

export const toast = {
  success: (title: ReactNode, options?: Options): string => show('success', title, options),
  warning: (title: ReactNode, options?: Options): string => show('warning', title, options),
  danger: (title: ReactNode, options?: Options): string => show('danger', title, options)
}
