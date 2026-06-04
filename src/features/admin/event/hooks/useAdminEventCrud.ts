"use client"

import { useCallback, useMemo, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '@/shared/lib/supabase'
import {
  addEvent,
  deleteEvent,
  EMPTY_EVENT_FORM,
  fromEventInputValue,
  getEvents,
  regenerateEventJoinKey,
  setEventJoinSettings,
  toEventInputValue,
  updateEvent,
} from '../lib'
import type { Event, EventFormData } from '../types'

interface UseAdminEventCrudOptions {
  onEventsLoaded?: (events: Event[]) => void
}

export function useAdminEventCrud({ onEventsLoaded }: UseAdminEventCrudOptions = {}) {
  const [events, setEvents] = useState<Event[]>([])
  const [openForm, setOpenForm] = useState(false)
  const [editing, setEditing] = useState<Event | null>(null)
  const [formData, setFormData] = useState<EventFormData>({ ...EMPTY_EVENT_FORM })
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Event | null>(null)

  const loadEvents = useCallback(async () => {
    const data = await getEvents()
    setEvents(data)
    onEventsLoaded?.(data)
  }, [onEventsLoaded])

  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      const aTime = a.start_time ? new Date(a.start_time).getTime() : 0
      const bTime = b.start_time ? new Date(b.start_time).getTime() : 0
      return aTime - bTime
    })
  }, [events])

  const openAdd = useCallback(() => {
    setEditing(null)
    setFormData({ ...EMPTY_EVENT_FORM })
    setOpenForm(true)
  }, [])

  const openEdit = useCallback((evt: Event) => {
    setEditing(evt)
    setFormData({
      name: evt.name || '',
      description: evt.description || '',
      join_mode: evt.join_mode || 'open',
      join_key: evt.join_key || '',
      start_time: toEventInputValue(evt.start_time || null),
      end_time: toEventInputValue(evt.end_time || null),
      always_show_challenges: Boolean(evt.always_show_challenges),
      image_url: evt.image_url || '',
      waves_count: evt.waves_count || 1,
    })
    setOpenForm(true)
  }, [])

  const handleSubmit = useCallback(async (e?: FormEvent) => {
    e?.preventDefault()
    if (!formData.name.trim()) {
      toast.error('Event name is required')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        name: formData.name.trim(),
        description: formData.description?.trim() || '',
        start_time: fromEventInputValue(formData.start_time),
        end_time: fromEventInputValue(formData.end_time),
        always_show_challenges: formData.always_show_challenges,
        image_url: formData.image_url?.trim() || null,
        waves_count: Number(formData.waves_count) || 1,
      }

      if (editing?.id) {
        await updateEvent(editing.id, payload)
        await setEventJoinSettings(editing.id, formData.join_mode, formData.join_mode === 'key' ? formData.join_key.trim() : null)
        toast.success('Event updated')
      } else {
        const created = await addEvent(payload)
        const createdEventId = Array.isArray(created) ? created[0]?.id : created?.id
        if (createdEventId) {
          await setEventJoinSettings(createdEventId, formData.join_mode, formData.join_mode === 'key' ? formData.join_key.trim() : null)
        }
        toast.success('Event created')
      }

      await loadEvents()
      setOpenForm(false)
      setEditing(null)
      setFormData({ ...EMPTY_EVENT_FORM })
    } catch (err) {
      console.error(err)
      toast.error('Failed to save event')
    } finally {
      setSubmitting(false)
    }
  }, [formData, editing, loadEvents])

  const handleRegenerateJoinKey = useCallback(async () => {
    if (!editing?.id) {
      toast.error('Save event first before regenerating key')
      return
    }
    try {
      const key = await regenerateEventJoinKey(editing.id)
      setFormData((prev) => ({ ...prev, join_key: key }))
      toast.success('Join key regenerated')
    } catch (err) {
      console.error(err)
      toast.error('Failed to regenerate join key')
    }
  }, [editing])

  const askDelete = useCallback((evt: Event) => {
    setPendingDelete(evt)
    setConfirmOpen(true)
  }, [])

  const doDelete = useCallback(async () => {
    if (!pendingDelete?.id) return
    try {
      await deleteEvent(pendingDelete.id)
      await loadEvents()
      toast.success('Event deleted')
    } catch (err) {
      console.error(err)
      toast.error('Failed to delete event')
    } finally {
      setPendingDelete(null)
      setConfirmOpen(false)
    }
  }, [pendingDelete, loadEvents])

  const [updatingEventId, setUpdatingEventId] = useState<string | null>(null)

  const handleTogglePause = useCallback(async (eventId: string, currentPaused: boolean) => {
    setUpdatingEventId(eventId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const res = await fetch('/api/admin/event/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          eventId,
          action: 'toggle-pause',
          isPaused: !currentPaused
        })
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to toggle event pause status')
      }

      toast.success(currentPaused ? 'Event resumed' : 'Event paused')
      await loadEvents()
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || 'Failed to toggle pause status')
    } finally {
      setUpdatingEventId(null)
    }
  }, [loadEvents])

  const handleToggleWave = useCallback(async (eventId: string, waveNumber: number, currentOpen: boolean) => {
    setUpdatingEventId(eventId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const action = currentOpen ? 'close-wave' : 'open-wave'
      const res = await fetch('/api/admin/event/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          eventId,
          action,
          waveNumber
        })
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to toggle wave status')
      }

      toast.success(currentOpen ? `Wave ${waveNumber} closed` : `Wave ${waveNumber} opened and Discord notified!`)
      await loadEvents()
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || 'Failed to toggle wave status')
    } finally {
      setUpdatingEventId(null)
    }
  }, [loadEvents])

  return {
    sortedEvents,
    loadEvents,
    openForm,
    setOpenForm,
    editing,
    formData,
    setFormData,
    submitting,
    handleSubmit,
    handleRegenerateJoinKey,
    openAdd,
    openEdit,
    askDelete,
    confirmOpen,
    setConfirmOpen,
    pendingDelete,
    doDelete,
    updatingEventId,
    handleTogglePause,
    handleToggleWave,
  }
}
