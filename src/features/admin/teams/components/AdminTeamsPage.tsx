'use client'

import React, { useEffect, useState } from 'react'
import { adminGetAllTeams, createTeam, deleteTeam, regenerateTeamInviteCode, kickTeamMember, TeamInfo } from '@/shared/lib/teams'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { Input } from '@/shared/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { Label } from '@/shared/ui/label'
import { Copy, Plus, RefreshCw, Trash2, Shield, Key, Lock, Users, X } from 'lucide-react'
import { toast } from 'react-hot-toast'

type AdminTeamMember = {
	id: string
	username: string
	is_captain: boolean
}

type AdminTeam = TeamInfo & {
	member_count: number
	captain_user_id: string | null
	member_names?: string[]
	members?: AdminTeamMember[]
}

export function AdminTeamsPage() {
	const [teams, setTeams] = useState<AdminTeam[]>([])
	const [loading, setLoading] = useState(true)
	const [searchQuery, setSearchQuery] = useState('')
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
	const [newTeamName, setNewTeamName] = useState('')
	const [isCreating, setIsCreating] = useState(false)

	const fetchTeams = async () => {
		setLoading(true)
		const { teams: data, error } = await adminGetAllTeams()
		if (error) {
			toast.error(error)
		} else {
			setTeams(data)
		}
		setLoading(false)
	}

	useEffect(() => {
		fetchTeams()
	}, [])

	const handleCreateTeam = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!newTeamName.trim()) return

		setIsCreating(true)
		const { teamId, error } = await createTeam(newTeamName)
		if (error) {
			toast.error(error)
		} else {
			toast.success('Team created successfully')
			setNewTeamName('')
			setIsCreateDialogOpen(false)
			fetchTeams()
		}
		setIsCreating(false)
	}

	const handleDeleteTeam = async (teamId: string, teamName: string) => {
		if (!confirm(`Are you sure you want to delete team "${teamName}"?`)) return

		const { success, error } = await deleteTeam(teamId)
		if (success) {
			toast.success('Team deleted')
			fetchTeams()
		} else {
			toast.error(error || 'Failed to delete team')
		}
	}

	const handleRegenerateInvite = async (teamId: string) => {
		if (!confirm('Are you sure you want to regenerate the invite code? The old one will no longer work.')) return

		const { invite_code, error } = await regenerateTeamInviteCode(teamId)
		if (error) {
			toast.error(error)
		} else {
			toast.success('Invite code regenerated')
			fetchTeams()
		}
	}

	const handleKickMember = async (teamId: string, teamName: string, userId: string, username: string, isCaptain: boolean) => {
		const confirmMsg = isCaptain
			? `Are you sure you want to remove the CAPTAIN "${username}" from team "${teamName}"? Another member will be promoted to captain.`
			: `Are you sure you want to remove "${username}" from team "${teamName}"?`

		if (!confirm(confirmMsg)) return

		const { success, error } = await kickTeamMember(teamId, userId)
		if (success) {
			toast.success(`Removed ${username} from team`)
			fetchTeams()
		} else {
			toast.error(error || 'Failed to remove member')
		}
	}

	const copyToClipboard = (text: string, label: string) => {
		navigator.clipboard.writeText(text)
		toast.success(`${label} copied to clipboard`)
	}

	const filteredTeams = teams.filter((t) =>
		t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
		t.id.toLowerCase().includes(searchQuery.toLowerCase())
	)

	return (
		<div className="p-6 space-y-6 animate-fade-in">
			<div className="flex justify-between items-center">
				<div>
					<h1 className="text-3xl font-bold bg-gradient-to-r from-white to-neutral-400 bg-clip-text text-transparent">
						Teams Management
					</h1>
					<p className="text-neutral-400 mt-1">Manage platform teams and their credentials.</p>
				</div>
				<Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
					<DialogTrigger asChild>
						<Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/20">
							<Plus className="w-4 h-4 mr-2" />
							Create New Team
						</Button>
					</DialogTrigger>
					<DialogContent className="bg-neutral-900/90 border-white/10 backdrop-blur-xl">
						<DialogHeader>
							<DialogTitle className="text-white">Create New Team</DialogTitle>
						</DialogHeader>
						<form onSubmit={handleCreateTeam} className="space-y-4 pt-4">
							<div className="space-y-2">
								<Label htmlFor="team-name" className="text-neutral-300">Team Name</Label>
								<Input
									id="team-name"
									value={newTeamName}
									onChange={(e) => setNewTeamName(e.target.value)}
									placeholder="Enter team name..."
									className="bg-white/5 border-white/10 text-white placeholder:text-neutral-500"
									autoFocus
								/>
							</div>
							<div className="flex justify-end gap-3 pt-4">
								<Button
									type="button"
									variant="ghost"
									onClick={() => setIsCreateDialogOpen(false)}
									className="text-neutral-400 hover:text-white"
								>
									Cancel
								</Button>
								<Button
									type="submit"
									disabled={isCreating || !newTeamName.trim()}
									className="bg-indigo-600 hover:bg-indigo-700"
								>
									{isCreating ? 'Creating...' : 'Create Team'}
								</Button>
							</div>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			<Card className="bg-white/5 border-white/10 backdrop-blur-md overflow-hidden">
				<CardHeader className="border-b border-white/5">
					<div className="flex items-center justify-between">
						<div className="relative w-72">
							<Input
								placeholder="Search teams by name or ID..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="bg-white/5 border-white/10 text-white pl-10"
							/>
							<Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
						</div>
						<Button
							variant="ghost"
							size="icon"
							onClick={fetchTeams}
							disabled={loading}
							className="text-neutral-400 hover:text-white"
						>
							<RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
						</Button>
					</div>
				</CardHeader>
				<CardContent className="p-0">
					<div className="overflow-x-auto">
						<Table>
							<TableHeader className="bg-white/[0.02]">
								<TableRow className="hover:bg-transparent border-white/5">
									<TableHead className="text-neutral-400 font-medium">Team Details</TableHead>
									<TableHead className="text-neutral-400 font-medium">Credentials</TableHead>
									<TableHead className="text-neutral-400 font-medium">Stats</TableHead>
									<TableHead className="text-right text-neutral-400 font-medium">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{loading ? (
									Array.from({ length: 5 }).map((_, i) => (
										<TableRow key={i} className="border-white/5">
											<TableCell colSpan={4} className="h-16 animate-pulse bg-white/[0.01]" />
										</TableRow>
									))
								) : filteredTeams.length === 0 ? (
									<TableRow>
										<TableCell colSpan={4} className="h-32 text-center text-neutral-500">
											No teams found.
										</TableCell>
									</TableRow>
								) : (
									filteredTeams.map((team) => (
										<TableRow key={team.id} className="border-white/5 hover:bg-white/[0.02] transition-colors group">
											<TableCell>
												<div className="flex flex-col">
													<span className="text-white font-medium text-lg">{team.name}</span>
													<span className="text-xs text-neutral-500 font-mono flex items-center mt-1">
														<Shield className="w-3 h-3 mr-1" />
														{team.id}
													</span>
													{team.members && team.members.length > 0 ? (
														<div className="flex flex-wrap gap-1.5 mt-2">
															{team.members.map((member) => (
																<span
																	key={member.id}
																	className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border transition-all ${
																		member.is_captain
																			? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
																			: 'bg-blue-500/10 text-blue-400 border-blue-500/20'
																	}`}
																>
																	{member.is_captain && <Shield className="w-3 h-3 text-amber-400 fill-amber-400/20" />}
																	<span>{member.username}</span>
																	<button
																		onClick={() => handleKickMember(team.id, team.name, member.id, member.username, member.is_captain)}
																		className="hover:bg-white/10 rounded p-0.5 ml-1 transition-colors text-neutral-500 hover:text-red-400"
																		title={`Remove ${member.username} from team`}
																	>
																		<X className="w-3 h-3" />
																	</button>
																</span>
															))}
														</div>
													) : (
														team.member_names && team.member_names.length > 0 && (
															<div className="flex flex-wrap gap-1 mt-2">
																{team.member_names.map((name, i) => (
																	<span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
																		{name}
																	</span>
																))}
															</div>
														)
													)}
												</div>
											</TableCell>
											<TableCell>
												<div className="flex flex-wrap gap-2">
													<CredentialBadge
														icon={<Key className="w-3 h-3" />}
														label="Invite Code"
														value={team.invite_code}
														onCopy={() => copyToClipboard(team.invite_code, 'Invite Code')}
														onRegenerate={() => handleRegenerateInvite(team.id)}
													/>
												</div>
											</TableCell>
											<TableCell>
												<div className="flex items-center text-neutral-400">
													<Users className="w-4 h-4 mr-2" />
													<span className="text-white font-medium">{team.member_count}</span>
													<span className="text-xs ml-1">members</span>
												</div>
											</TableCell>
											<TableCell className="text-right">
												<Button
													variant="ghost"
													size="icon"
													onClick={() => handleDeleteTeam(team.id, team.name)}
													className="text-neutral-500 hover:text-red-400 hover:bg-red-400/10 transition-all opacity-0 group-hover:opacity-100"
												>
													<Trash2 className="w-4 h-4" />
												</Button>
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}

function CredentialBadge({ icon, label, value, onCopy, onRegenerate }: { icon: React.ReactNode, label: string, value: string, onCopy: () => void, onRegenerate?: () => void }) {
	return (
		<div className="flex items-center bg-white/5 border border-white/10 rounded-md px-2 py-1 gap-2 hover:border-white/20 transition-colors">
			<span className="text-neutral-500">{icon}</span>
			<span className="text-xs font-mono text-neutral-300 max-w-[80px] truncate">{value}</span>
			<div className="flex items-center gap-1 ml-auto">
				<button
					onClick={onCopy}
					className="text-neutral-500 hover:text-white transition-colors p-1"
					title={`Copy ${label}`}
				>
					<Copy className="w-3 h-3" />
				</button>
				{onRegenerate && (
					<button
						onClick={onRegenerate}
						className="text-neutral-500 hover:text-blue-400 transition-colors p-1"
						title={`Regenerate ${label}`}
					>
						<RefreshCw className="w-3 h-3" />
					</button>
				)}
			</div>
		</div>
	)
}
