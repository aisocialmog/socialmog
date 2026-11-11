// Tasks, time log, activity feed (feature 8).
import { db } from './db'
import { supabase } from '../lib/supabase'
import { brandsApi } from './brands'
import type { ActivityEntry } from '../lib/activity'
import type { Priority, TaskStatus } from '../lib/tasks'
import type { FileRow } from '../components/files/RecordFiles'

export interface Task {
  id: string; title: string; description: string | null; status: TaskStatus; priority: Priority
  assignee_id: string | null; due_date: string | null; due_time: string | null; completed_at: string | null; estimate_hours: number | null
  recurring_id: string | null; is_archived: boolean; created_at: string; created_by: string | null
  brand_id: string | null; creator_id: string | null; campaign_id: string | null; deliverable_id: string | null; invoice_id: string | null
  is_overdue: boolean; link_table: string | null; link_id: string | null; link_name: string | null
  assignee_ids: string[]; assignee_names: string[]; checklist_total: number; checklist_done: number; minutes_logged: number
}
export interface TaskInput {
  title: string; description?: string | null; status?: TaskStatus; priority?: Priority; due_date?: string | null; due_time?: string | null; estimate_hours?: number | null
  brand_id?: string | null; creator_id?: string | null; campaign_id?: string | null; deliverable_id?: string | null; invoice_id?: string | null
}
export interface Member { id: string; name: string; role: string; photo_path: string | null }
export interface ChecklistItem { id: string; task_id: string; title: string; is_done: boolean; position: number; is_archived: boolean }
export interface Comment { id: string; body: string; created_at: string; created_by: string | null }
export interface TimeLog { id: string; member_id: string; task_id: string; started_at: string; ended_at: string | null; duration_minutes: number | null; source: string }
export interface Recurring { id: string; title: string; description: string | null; frequency: 'daily' | 'weekly' | 'monthly'; next_on: string; due_time: string | null; priority: Priority; assignee_id: string | null; brand_id: string | null; is_paused: boolean; is_archived: boolean }
export interface FeedEntry extends ActivityEntry { record_name: string | null }
export interface WorkSummary { member_id: string; name: string; role: string; tasks_done: number; hours_logged: number; records_created: number; records_updated: number }

const LINKS = ['brand_id', 'creator_id', 'campaign_id', 'deliverable_id', 'invoice_id'] as const
export type LinkField = typeof LINKS[number]
/** A task links to one record: setting one clears the others. */
export const linkPatch = (field: LinkField | null, id: string | null) => Object.fromEntries(LINKS.map(k => [k, k === field ? id : null]))

export const workApi = {
  members: () => db.rows<Member>('team_directory', {}, 'name'),
  async brands(): Promise<{ id: string; name: string }[]> {
    return supabase ? (await brandsApi.list()).map(b => ({ id: b.id, name: b.name })) : db.rows('brands_lite')
  },
  tasks: () => db.rows<Task>('task_list', { is_archived: false }, 'due_date'),
  async task(id: string) { return (await db.rows<Task>('task_list', { id }))[0] ?? null },
  async create(input: TaskInput, assigneeIds: string[]): Promise<string> {
    const t = await db.insert<{ id: string }>('tasks', { ...input, assignee_id: assigneeIds[0] ?? null })
    for (const m of assigneeIds.slice(1)) await db.insert('task_assignees', { task_id: t.id, member_id: m })
    return t.id
  },
  update: (id: string, patch: Partial<TaskInput> & { is_archived?: boolean }) => db.update('tasks', id, patch),
  async setAssignees(task: Task, ids: string[]) {
    await db.update('tasks', task.id, { assignee_id: ids[0] ?? null })
    for (const m of task.assignee_ids.filter(x => !ids.includes(x))) await db.del('task_assignees', { task_id: task.id, member_id: m })
    for (const m of ids.filter(x => !task.assignee_ids.includes(x) && x !== ids[0])) await db.insert('task_assignees', { task_id: task.id, member_id: m })
  },
  checklist: (taskId: string) => db.rows<ChecklistItem>('task_checklist_items', { task_id: taskId, is_archived: false }, 'position'),
  addCheck: (taskId: string, title: string, position: number) => db.insert('task_checklist_items', { task_id: taskId, title, position }),
  patchCheck: (id: string, patch: Partial<ChecklistItem>) => db.update('task_checklist_items', id, patch),
  comments: (taskId: string) => db.rows<Comment>('comments', { task_id: taskId, is_archived: false }, 'created_at'),
  addComment: (taskId: string, body: string) => db.insert('comments', { task_id: taskId, body }),
  logs: (taskId: string) => db.rows<TimeLog>('time_logs', { task_id: taskId }, 'started_at', false),
  async running(memberId: string) { return (await db.rows<TimeLog>('time_logs', { member_id: memberId, ended_at: null }))[0] ?? null },
  startTimer: (taskId: string, source: 'timer' | 'focus' = 'timer') => db.rpc('timer_start', { p_task: taskId, p_source: source }),
  stopTimer: () => db.rpc('timer_stop'),
  recurring: () => db.rows<Recurring>('recurring_tasks', { is_archived: false }, 'next_on'),
  saveRecurring: (r: Omit<Recurring, 'id' | 'is_archived' | 'is_paused'>) => db.insert('recurring_tasks', r),
  patchRecurring: (id: string, patch: Partial<Recurring>) => db.update('recurring_tasks', id, patch),
  activity: (taskId: string) => db.rpc<ActivityEntry[]>('task_activity', { p_task: taskId }),
  feed: (from: string, to: string, actor: string | null, tables: string[] | null) =>
    db.rpc<FeedEntry[]>('activity_feed', { p_from: from, p_to: to, p_actor: actor, p_tables: tables }),
  summary: (from: string, to: string) => db.rpc<WorkSummary[]>('work_summary', { p_from: from, p_to: to }),

  // attachments: private "records" bucket, folder tasks/<id>/
  files: (taskId: string) => db.rows<FileRow>('files', { task_id: taskId, is_archived: false }, 'created_at', false),
  async uploadFile(taskId: string, file: File) {
    const path = `tasks/${taskId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_')}`
    if (supabase) { const { error } = await supabase.storage.from('records').upload(path, file, { contentType: file.type || undefined }); if (error) throw new Error(error.message) }
    try { await db.insert('files', { bucket: 'records', storage_path: supabase ? path : `preview:${URL.createObjectURL(file)}`, file_name: file.name, mime_type: file.type || null, size_bytes: file.size, kind: 'other', task_id: taskId }) }
    catch (e) { await supabase?.storage.from('records').remove([path]); throw e }
  },
  archiveFile: (id: string) => db.update('files', id, { is_archived: true }),
  signedUrl: (path: string, name: string) => brandsApi.signedUrl(path, name),
}
