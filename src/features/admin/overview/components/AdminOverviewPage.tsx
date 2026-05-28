"use client"

import { Loader } from '@/shared/components'
import { Card, CardContent } from '@/shared/ui'
import { Users, ShieldAlert, User, Logs } from 'lucide-react'
import Link from 'next/link'
import AuditLogList from './AuditLogList'
import OverviewStatsCards from './OverviewStatsCards'
import StatsGraph from './StatsGraph'
import { useAdminOverviewData } from '../hooks/useAdminOverviewData'
import { AdminPageShell } from '../../shared'

export default function AdminOverviewPage() {
  const {
    user,
    authLoading,
    isLoading,
    challenges,
    siteInfo,
    timeRange,
    activityData,
    refreshStats,
  } = useAdminOverviewData()

  if (authLoading || isLoading) return <Loader fullscreen color="text-blue-500" />
  if (!user) return null

  return (
    <AdminPageShell>
      <div className="space-y-6">
        <OverviewStatsCards siteInfo={siteInfo} challengeCount={challenges.length} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Link href="/admin/teams">
            <Card className="bg-indigo-600 hover:bg-indigo-700 text-white transition-all cursor-pointer shadow-lg shadow-indigo-500/20 group">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold">Teams Management</h3>
                    <p className="text-indigo-100 text-sm opacity-80">Manage teams, members, and credentials</p>
                  </div>
                  <Users className="w-8 h-8 opacity-40 group-hover:opacity-100 transition-opacity" />
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/admin/monitoring">
            <Card className="bg-red-600 hover:bg-red-700 text-white transition-all cursor-pointer shadow-lg shadow-red-500/20 group">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold">Solves Monitoring</h3>
                    <p className="text-red-100 text-sm opacity-80">Track sharing flags, oneshots, and AI agents</p>
                  </div>
                  <ShieldAlert className="w-8 h-8 opacity-40 group-hover:opacity-100 transition-opacity" />
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/admin/users">
            <Card className="bg-emerald-600 hover:bg-emerald-700 text-white transition-all cursor-pointer shadow-lg shadow-emerald-500/20 group">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold">Users Management</h3>
                    <p className="text-emerald-100 text-sm opacity-80">View all users, search, and delete accounts</p>
                  </div>
                  <User className="w-8 h-8 opacity-40 group-hover:opacity-100 transition-opacity" />
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/admin/logs">
            <Card className="bg-blue-600 hover:bg-blue-700 text-white transition-all cursor-pointer shadow-lg shadow-blue-500/20 group">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold">All Logs</h3>
                    <p className="text-blue-100 text-sm opacity-80">Track telemetry, views, and flag attempts</p>
                  </div>
                  <Logs className="w-8 h-8 opacity-40 group-hover:opacity-100 transition-opacity" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>


        <Card className="bg-white dark:bg-gray-800 pt-5">
          <CardContent>
            <StatsGraph
              data={activityData}
              range={timeRange}
              onRangeChange={refreshStats}
            />
          </CardContent>
        </Card>

        <AuditLogList />
      </div>
    </AdminPageShell>
  )
}
