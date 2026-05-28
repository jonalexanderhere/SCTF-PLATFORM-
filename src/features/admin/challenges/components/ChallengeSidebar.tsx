import React from 'react'
import Link from 'next/link'
import { Users, ShieldAlert, User, Logs } from 'lucide-react'
import { Button, Card, CardContent } from '@/shared/ui'
import ChallengeOverviewCard from './ChallengeOverviewCard'
import RecentSolversList from './RecentSolversList'
import type { Challenge, SiteInfo, SolverRow } from '../types'

interface ChallengeSidebarProps {
  challenges: Challenge[]
  solvers: SolverRow[]
  siteInfo: SiteInfo | null
  isGlobalAdmin: boolean
  onViewAllSolvers: () => void
}

const ChallengeSidebar: React.FC<ChallengeSidebarProps> = ({
  challenges,
  solvers,
  siteInfo,
  isGlobalAdmin,
  onViewAllSolvers,
}) => {
  return (
    <aside className="lg:col-span-1 order-2 lg:order-none space-y-6 sticky top-0">
      <ChallengeOverviewCard
        challenges={challenges}
        info={isGlobalAdmin ? (siteInfo || undefined) : undefined}
        showViewAll={isGlobalAdmin}
      />
      <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm">
        <CardContent className="pt-6 space-y-3">
          <Link href="/admin/teams">
            <Button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
              <Users className="w-4 h-4" />
              Manage Teams
            </Button>
          </Link>
          <Link href="/admin/monitoring">
            <Button variant="outline" className="w-full border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400 dark:hover:bg-indigo-950/30 hover:text-indigo-700 dark:hover:text-indigo-300 gap-2">
              <ShieldAlert className="w-4 h-4" />
              Monitor Solves
            </Button>
          </Link>
          <Link href="/admin/users">
            <Button variant="outline" className="w-full border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400 dark:hover:bg-indigo-950/30 hover:text-indigo-700 dark:hover:text-indigo-300 gap-2">
              <User className="w-4 h-4" />
              Manage Users
            </Button>
          </Link>
          <Link href="/admin/logs">
            <Button variant="outline" className="w-full border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400 dark:hover:bg-indigo-950/30 hover:text-indigo-700 dark:hover:text-indigo-300 gap-2">
              <Logs className="w-4 h-4" />
              All Logs
            </Button>
          </Link>
        </CardContent>
      </Card>

      <RecentSolversList solvers={solvers} onViewAll={onViewAllSolvers} />
    </aside>
  )
}

export default ChallengeSidebar
