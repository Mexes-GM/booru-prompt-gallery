import * as React from "react"
import { useState, useEffect } from "react"
import { Input, type InputProps } from "@/components/ui/input"

export interface DebouncedInputProps extends Omit<InputProps, "value" | "onChange"> {
  value: string
  onChange: (value: string) => void
  debounceTime?: number
}

export function DebouncedInput({ 
  value, 
  onChange, 
  debounceTime = 500, 
  ...props 
}: DebouncedInputProps) {
  const [internalValue, setInternalValue] = useState(value)

  useEffect(() => {
    setInternalValue(value)
  }, [value])

  useEffect(() => {
    const handler = setTimeout(() => {
      if (internalValue !== value) {
        onChange(internalValue)
      }
    }, debounceTime)

    return () => {
      clearTimeout(handler)
    }
  }, [internalValue, value, debounceTime, onChange])

  return (
    <Input
      {...props}
      value={internalValue}
      onChange={(e) => setInternalValue(e.target.value)}
    />
  )
}

export function DebouncedHTMLInput({ 
  value, 
  onChange, 
  debounceTime = 500, 
  ...props 
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onChange: (value: string) => void; debounceTime?: number }) {
  const [internalValue, setInternalValue] = useState(value)

  useEffect(() => {
    setInternalValue(value)
  }, [value])

  useEffect(() => {
    const handler = setTimeout(() => {
      if (internalValue !== value) {
        onChange(internalValue)
      }
    }, debounceTime)

    return () => {
      clearTimeout(handler)
    }
  }, [internalValue, value, debounceTime, onChange])

  return (
    <input
      {...props}
      value={internalValue}
      onChange={(e) => setInternalValue(e.target.value)}
    />
  )
}
