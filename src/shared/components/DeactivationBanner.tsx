'use client'

import React from 'react'
import { useAuth } from '@/shared/contexts'
import { ShieldAlert } from 'lucide-react'

export function DeactivationBanner() {
	const { user } = useAuth()

	if (!user || user.team_is_active !== false) {
		return null
	}

	return (
		<div className="w-full bg-red-500/10 border-b border-red-500/20 backdrop-blur-md px-4 py-3 text-red-200 flex items-center justify-center gap-3">
			<ShieldAlert className="w-5 h-5 text-red-500 shrink-0 animate-bounce" />
			<div className="text-sm font-medium">
				<span>Tim Anda telah dinonaktifkan oleh Admin: </span>
				<span className="font-bold underline decoration-red-500/50">
					"{user.team_deactivation_message || 'TERDETEKSI AI AGENT'}"
				</span>
				<span className="ml-1 text-red-400 text-xs block sm:inline mt-0.5 sm:mt-0">
					(Poin solve tim & member ditangguhkan dan tidak masuk scoreboard)
				</span>
			</div>
		</div>
	)
}
