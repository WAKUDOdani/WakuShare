import { queue } from '@/lib/notifications'
import type { JSX } from 'react'
import { Toast } from '@heroui/react'
import { t, useLanguage } from '@/lib/i18n'

export function Notifications(): JSX.Element {
  useLanguage()
  return (
    <Toast.Provider queue={queue} placement="bottom end">
      {({ toast: item }) => (
        <Toast toast={item} variant={item.content.variant} placement="bottom end">
          <Toast.Indicator variant={item.content.variant} />
          <Toast.Content>
            <Toast.Title>{item.content.title}</Toast.Title>
            {item.content.description && (
              <Toast.Description>{item.content.description}</Toast.Description>
            )}
          </Toast.Content>
          {item.content.actionProps && <Toast.ActionButton {...item.content.actionProps} />}
          <Toast.CloseButton aria-label={t('Close')} />
        </Toast>
      )}
    </Toast.Provider>
  )
}
