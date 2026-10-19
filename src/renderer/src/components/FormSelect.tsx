import type { JSX } from 'react'
import { Label, ListBox, Select } from '@heroui/react'

interface FormSelectProps {
  label: string
  value: string
  options: { id: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
  showLabel?: boolean
}

/** Uses the same trigger, popover and selection animation as the Settings selectors. */
export function FormSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  showLabel
}: FormSelectProps): JSX.Element {
  return (
    <Select
      aria-label={label}
      className="w-full min-w-0"
      value={value}
      isDisabled={disabled}
      onChange={(key) => {
        if (key !== null) onChange(String(key))
      }}
    >
      {showLabel && <Label>{label}</Label>}
      <Select.Trigger className="rounded-full">
        <Select.Value className="truncate" />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="max-w-[calc(100vw-2rem)]">
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              <span className="min-w-0 flex-1 truncate" title={option.label}>
                {option.label}
              </span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}
