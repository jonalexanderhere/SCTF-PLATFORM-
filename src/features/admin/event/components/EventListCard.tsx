import React from 'react'
import { motion } from 'framer-motion'
import { Inbox } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui'
import { EmptyState } from '@/shared/components'
import type { Event } from '../types'

interface EventListCardProps {
  events: Event[]
  onAdd: () => void
  onEdit: (evt: Event) => void
  onDelete: (evt: Event) => void
  updatingEventId?: string | null
  onTogglePause?: (eventId: string, currentPaused: boolean) => void
  onToggleWave?: (eventId: string, waveNumber: number, currentOpen: boolean) => void
}

const EventListCard: React.FC<EventListCardProps> = ({
  events,
  onAdd,
  onEdit,
  onDelete,
  updatingEventId = null,
  onTogglePause,
  onToggleWave,
}) => {
  return (
    <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-gray-900 dark:text-white">Event List</CardTitle>
        <Button onClick={onAdd} className="bg-primary-600 text-white hover:bg-primary-700">
          + Add Event
        </Button>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <EmptyState
            icon={<Inbox className="w-full h-full" />}
            title="No events yet"
            description="Create your first event to get started."
            containerHeight="py-10"
          />
        ) : (
          <motion.div
            className="divide-y border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            {events.map((evt) => {
              const isPaused = !!evt.is_paused
              const activeWaves = evt.active_waves || []
              const wavesCount = evt.waves_count || 1

              return (
                <div key={evt.id} className="px-4 py-4 flex flex-col gap-3 bg-white dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-semibold text-base text-gray-900 dark:text-white truncate">{evt.name}</div>
                        {isPaused ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20">
                            Paused ⏸️
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            Active ▶️
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">{evt.description || 'No description'}</div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        {evt.start_time ? `Start: ${new Date(evt.start_time).toLocaleString()}` : 'Start: -'}
                        <span className="mx-2">•</span>
                        {evt.end_time ? `End: ${new Date(evt.end_time).toLocaleString()}` : 'End: -'}
                        {evt.always_show_challenges && (
                          <>
                            <span className="mx-2">•</span>
                            Always show challenges
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {onTogglePause && (
                        <Button
                          variant={isPaused ? 'outline' : 'destructive'}
                          size="sm"
                          disabled={updatingEventId === evt.id}
                          onClick={() => onTogglePause(evt.id, isPaused)}
                          className={isPaused ? 'border-emerald-500 text-emerald-500 hover:bg-emerald-500/10' : 'bg-yellow-600 text-white hover:bg-yellow-700'}
                        >
                          {isPaused ? 'Resume Event' : 'Pause Event'}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => onEdit(evt)}>
                        Edit
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => onDelete(evt)}>
                        Delete
                      </Button>
                    </div>
                  </div>

                  {/* Waves Management Controls */}
                  {onToggleWave && (
                    <div className="mt-1 pt-3 border-t border-gray-100 dark:border-gray-800/80 flex flex-wrap items-center gap-3">
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 shrink-0">
                        Waves ({wavesCount}):
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        {Array.from({ length: wavesCount }, (_, i) => {
                          const waveNum = i + 1
                          const isOpen = activeWaves.includes(waveNum)
                          return (
                            <button
                              key={waveNum}
                              type="button"
                              disabled={updatingEventId === evt.id}
                              onClick={() => onToggleWave(evt.id, waveNum, isOpen)}
                              className={`px-3 py-1 rounded-md text-xs font-bold border transition-all flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50 ${
                                isOpen
                                  ? 'bg-blue-500/10 text-blue-500 border-blue-500/25 hover:bg-blue-500/20'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700'
                              }`}
                            >
                              <span>Wave {waveNum}</span>
                              <span className="text-[10px] uppercase font-black px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5">
                                {isOpen ? 'Open 🌊' : 'Closed 🔒'}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </motion.div>
        )}
      </CardContent>
    </Card>
  )
}

export default EventListCard
