"use client"

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { 
  Search, 
  Logs, 
  Eye, 
  CheckCircle, 
  XCircle, 
  RefreshCw, 
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Trash2
} from 'lucide-react'
import toast from 'react-hot-toast'
import { 
  Button, 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle,
  Input, 
  Badge, 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/shared/ui'
import { Loader } from '@/shared/components'
import { useAuth } from '@/shared/hooks'
import { isAdmin } from '@/shared/lib'
import { AdminPageShell } from '../../shared'

interface LogEntry {
  id: string
  created_at: string
  user_id: string
  username: string
  team_name: string
  challenge_id: string
  challenge_title: string
  event_type: 'view' | 'submission'
  submitted_flag: string | null
  is_correct: boolean | null
}

interface SuspectEntry {
  username: string
  team_name: string
  incorrect_count: number
  last_attempt_at: string
}

interface StatsData {
  total_views: number
  total_solves: number
  total_incorrect: number
}

export default function AdminLogsPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [isAdminUser, setIsAdminUser] = useState(false)
  const [authChecking, setAuthChecking] = useState(true)

  // State data
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [suspects, setSuspects] = useState<SuspectEntry[]>([])
  const [stats, setStats] = useState<StatsData>({ total_views: 0, total_solves: 0, total_incorrect: 0 })
  
  // UI states
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'view' | 'correct' | 'incorrect'>('all')
  
  // Pagination
  const [total, setTotal] = useState(0)
  const [limit] = useState(25)
  const [page, setPage] = useState(1)

  // Clear logs modal state
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [isClearing, setIsClearing] = useState(false)

  // Verify Admin Access
  useEffect(() => {
    let mounted = true
    const initAuth = async () => {
      if (authLoading) return

      if (!user) {
        router.push('/challenges')
        return
      }

      const adminCheck = await isAdmin()
      if (!mounted) return
      setIsAdminUser(adminCheck)
      if (!adminCheck) {
        router.push('/challenges')
        return
      }
      setAuthChecking(false)
    }

    initAuth()
    return () => {
      mounted = false
    }
  }, [authLoading, user, router])

  // Fetch telemetry logs
  const fetchLogs = useCallback(async (showLoader = true) => {
    if (!user) return
    
    if (showLoader) {
      setIsLoading(true)
    } else {
      setIsRefreshing(true)
    }

    try {
      // Get current supabase session for Authorization token
      const { supabase } = await import('@/shared/lib/supabase')
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      if (!token) {
        toast.error('Session token not found. Re-authenticating...')
        return
      }

      const offset = (page - 1) * limit
      const queryParams = new URLSearchParams({
        search: searchQuery,
        type: filterType,
        limit: String(limit),
        offset: String(offset)
      })

      const res = await fetch(`/api/admin/logs?${queryParams.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to fetch logs')
      }

      const data = await res.json()
      setLogs(data.logs || [])
      setTotal(data.total || 0)
      setSuspects(data.suspects || [])
      setStats(data.stats || { total_views: 0, total_solves: 0, total_incorrect: 0 })
    } catch (err: any) {
      console.error('[AdminLogsPage] Fetch error:', err)
      toast.error(err.message || 'Failed to load telemetry logs')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [user, searchQuery, filterType, page, limit])

  // Trigger fetch when parameters change
  useEffect(() => {
    if (!authChecking && isAdminUser) {
      fetchLogs(true)
    }
  }, [authChecking, isAdminUser, page, filterType, fetchLogs])

  // Handle Search submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    fetchLogs(true)
  }

  // Handle Refresh button click
  const handleRefreshClick = () => {
    fetchLogs(false)
  }

  // Handle Clear Logs action
  const handleClearLogs = async () => {
    setIsClearing(true)
    try {
      const { supabase } = await import('@/shared/lib/supabase')
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      if (!token) {
        toast.error('Session token not found.')
        return
      }

      const res = await fetch('/api/admin/logs', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to clear logs')
      }

      toast.success('Successfully cleared all telemetry logs!')
      setClearConfirmOpen(false)
      setPage(1)
      fetchLogs(false)
    } catch (err: any) {
      console.error('[AdminLogsPage] Clear error:', err)
      toast.error(err.message || 'Failed to clear logs')
    } finally {
      setIsClearing(false)
    }
  }

  // Formatting helper for date strings
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    } catch {
      return dateStr
    }
  }

  // Calculate total pages
  const totalPages = Math.ceil(total / limit)

  if (authLoading || authChecking || (isLoading && logs.length === 0)) {
    return <Loader fullscreen color="text-blue-500" />
  }

  if (!user || !isAdminUser) return null

  return (
    <AdminPageShell>
      <div className="space-y-6 pb-12">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
              <Logs className="w-6 h-6 text-indigo-500" />
              All User Activity Logs
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Monitor challenge views, flag attempts, incorrect flags count, and timestamps in real-time.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshClick}
              disabled={isRefreshing || isLoading}
              className="gap-2 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setClearConfirmOpen(true)}
              disabled={isRefreshing || isLoading || logs.length === 0}
              className="gap-2 border-red-200 text-red-600 dark:border-red-900 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20"
            >
              <Trash2 className="w-4 h-4" />
              Clear Logs
            </Button>
          </div>
        </div>

        {/* Telemetry Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-gradient-to-br from-blue-50 to-white dark:from-gray-900 dark:to-gray-800 border-blue-200 dark:border-blue-900 shadow-sm">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Total Challenge Views</p>
                  <h3 className="text-3xl font-extrabold text-gray-900 dark:text-white">{stats.total_views}</h3>
                </div>
                <div className="p-3 bg-blue-100 dark:bg-blue-950/50 rounded-xl text-blue-600 dark:text-blue-400">
                  <Eye className="w-6 h-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-emerald-50 to-white dark:from-gray-900 dark:to-gray-800 border-emerald-200 dark:border-emerald-900 shadow-sm">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Correct Solves</p>
                  <h3 className="text-3xl font-extrabold text-gray-900 dark:text-white">{stats.total_solves}</h3>
                </div>
                <div className="p-3 bg-emerald-100 dark:bg-emerald-950/50 rounded-xl text-emerald-600 dark:text-emerald-400">
                  <CheckCircle className="w-6 h-6" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-red-50 to-white dark:from-gray-900 dark:to-gray-800 border-red-200 dark:border-red-900 shadow-sm">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider">Incorrect Flag Attempts</p>
                  <h3 className="text-3xl font-extrabold text-gray-900 dark:text-white">{stats.total_incorrect}</h3>
                </div>
                <div className="p-3 bg-red-100 dark:bg-red-950/50 rounded-xl text-red-600 dark:text-red-400">
                  <XCircle className="w-6 h-6" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Suspect / Brute Force Analysis Section */}
        {suspects.length > 0 && (
          <Card className="bg-white dark:bg-gray-800 border-yellow-200 dark:border-yellow-900 shadow-sm border-l-4 border-l-yellow-500">
            <CardHeader className="pb-3">
              <CardTitle className="text-md font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
                Potential Brute-Force Suspects (Top Incorrect Attempts)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-200 dark:border-gray-700">
                      <TableHead className="font-semibold text-xs uppercase tracking-wider">Player Name</TableHead>
                      <TableHead className="font-semibold text-xs uppercase tracking-wider">Team</TableHead>
                      <TableHead className="font-semibold text-xs uppercase tracking-wider text-center">Incorrect Submissions</TableHead>
                      <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Last Attempt Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suspects.map((suspect, idx) => (
                      <TableRow 
                        key={suspect.username} 
                        className={`border-gray-100 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-800/50`}
                      >
                        <TableCell className="font-medium text-gray-900 dark:text-white flex items-center gap-2 py-3">
                          <span className="text-xs text-gray-400">#{idx + 1}</span>
                          {suspect.username}
                        </TableCell>
                        <TableCell className="text-gray-500 dark:text-gray-400">{suspect.team_name}</TableCell>
                        <TableCell className="text-center py-3">
                          <Badge 
                            variant="outline" 
                            className={`font-semibold border-red-200 text-red-700 bg-red-50 dark:bg-red-950/20 dark:border-red-900 dark:text-red-400 px-2.5 py-0.5`}
                          >
                            {suspect.incorrect_count} attempts
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-gray-400 text-xs py-3">{formatDate(suspect.last_attempt_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Log List Card */}
        <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm">
          <CardHeader className="pb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-100 dark:border-gray-700/50">
            <div>
              <CardTitle className="text-md font-bold text-gray-900 dark:text-white">Activity Timeline</CardTitle>
            </div>
            
            {/* Log Filters */}
            <div className="flex flex-wrap gap-2">
              {(['all', 'view', 'correct', 'incorrect'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => {
                    setFilterType(type)
                    setPage(1)
                  }}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors capitalize ${
                    filterType === type
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {type === 'correct' ? 'Solved' : type === 'incorrect' ? 'Wrong Flags' : type}
                </button>
              ))}
            </div>
          </CardHeader>

          {/* Search Box */}
          <div className="p-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50">
            <form onSubmit={handleSearchSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search by player username or challenge title..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 dark:bg-gray-900 dark:border-gray-700 focus-visible:ring-indigo-500"
                />
              </div>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white px-5">
                Search
              </Button>
            </form>
          </div>

          <CardContent className="p-0">
            {isLoading ? (
              <div className="h-60 flex items-center justify-center">
                <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
              </div>
            ) : logs.length === 0 ? (
              <div className="py-16 text-center">
                <Logs className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400 font-medium">No activity logs found</p>
                <p className="text-xs text-gray-400 mt-1">Try adjusting your filters or search query</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-200 dark:border-gray-700">
                      <TableHead className="font-semibold text-xs uppercase tracking-wider py-3.5 pl-6">Timestamp</TableHead>
                      <TableHead className="font-semibold text-xs uppercase tracking-wider py-3.5">User (Team)</TableHead>
                      <TableHead className="font-semibold text-xs uppercase tracking-wider py-3.5">Activity</TableHead>
                      <TableHead className="font-semibold text-xs uppercase tracking-wider py-3.5">Challenge</TableHead>
                      <TableHead className="font-semibold text-xs uppercase tracking-wider py-3.5 pr-6">Submitted Payload</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => {
                      const isSolve = log.event_type === 'submission' && log.is_correct === true
                      const isWrong = log.event_type === 'submission' && log.is_correct === false
                      const isView = log.event_type === 'view'

                      return (
                        <TableRow 
                          key={log.id} 
                          className="border-gray-100 dark:border-gray-700/50 hover:bg-gray-50/30 dark:hover:bg-gray-900/10"
                        >
                          <TableCell className="text-xs text-gray-500 dark:text-gray-400 py-3.5 pl-6">
                            {formatDate(log.created_at)}
                          </TableCell>
                          <TableCell className="py-3.5">
                            <span className="font-bold text-gray-900 dark:text-white block">
                              {log.username}
                            </span>
                            <span className="text-xs text-gray-400">
                              Team: {log.team_name}
                            </span>
                          </TableCell>
                          <TableCell className="py-3.5">
                            {isSolve && (
                              <Badge className="bg-emerald-100 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400 font-semibold px-2 py-0.5 border border-emerald-200 dark:border-emerald-900/50 gap-1">
                                <CheckCircle className="w-3.5 h-3.5" />
                                Solved
                              </Badge>
                            )}
                            {isWrong && (
                              <Badge className="bg-red-100 hover:bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400 font-semibold px-2 py-0.5 border border-red-200 dark:border-red-900/50 gap-1">
                                <XCircle className="w-3.5 h-3.5" />
                                Wrong Flag
                              </Badge>
                            )}
                            {isView && (
                              <Badge className="bg-blue-100 hover:bg-blue-100 text-blue-800 dark:bg-blue-950/30 dark:text-blue-400 font-semibold px-2 py-0.5 border border-blue-200 dark:border-blue-900/50 gap-1">
                                <Eye className="w-3.5 h-3.5" />
                                Opened
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-semibold text-gray-900 dark:text-white py-3.5">
                            {log.challenge_title}
                          </TableCell>
                          <TableCell className="py-3.5 pr-6 max-w-xs md:max-w-sm truncate">
                            {log.event_type === 'submission' && log.submitted_flag ? (
                              <code className="text-xs font-mono bg-gray-100 dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded select-all break-all border border-gray-200/50 dark:border-gray-700/50">
                                {log.submitted_flag}
                              </code>
                            ) : (
                              <span className="text-gray-400 dark:text-gray-600 text-xs italic">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Pagination Controls */}
            {totalPages > 1 && !isLoading && (
              <div className="p-4 border-t border-gray-100 dark:border-gray-700/50 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/30">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Showing page {page} of {totalPages} ({total} total logs)
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="gap-1 dark:border-gray-700 dark:text-gray-300"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    className="gap-1 dark:border-gray-700 dark:text-gray-300"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Clear confirmation dialog */}
      <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <DialogContent className="sm:max-w-[425px] bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-gray-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500 animate-pulse" />
              Clear All Telemetry Logs
            </DialogTitle>
            <DialogDescription className="text-gray-500 dark:text-gray-400 pt-2">
              Are you sure you want to delete all challenge views and flag submission telemetry logs?
              This will reset stats and suspects list. This action is permanent and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setClearConfirmOpen(false)}
              disabled={isClearing}
              className="dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleClearLogs}
              disabled={isClearing}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold"
            >
              {isClearing ? 'Clearing...' : 'Yes, Clear All'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPageShell>
  )
}
