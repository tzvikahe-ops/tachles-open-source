export interface PlanningTask {
  id: string;
  title: string;
  priority: number;
  dueAt: string | null;
  estimatedMinutes: number | null;
}

export interface BusyWindow {
  start: string;
  end: string;
}

export interface PlannedBlock {
  taskId: string;
  title: string;
  start: string;
  end: string;
  atRisk: boolean;
}

interface Interval {
  start: number;
  end: number;
}

function compareTasks(a: PlanningTask, b: PlanningTask): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const aDue = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
  const bDue = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
  return aDue - bDue;
}

function subtractBusy(window: Interval, busy: Interval[]): Interval[] {
  let free = [window];
  for (const block of busy) {
    free = free.flatMap((slot) => {
      if (block.end <= slot.start || block.start >= slot.end) return [slot];
      const pieces: Interval[] = [];
      if (block.start > slot.start) pieces.push({ start: slot.start, end: block.start });
      if (block.end < slot.end) pieces.push({ start: block.end, end: slot.end });
      return pieces;
    });
  }
  return free;
}

export function planTasks(
  tasks: PlanningTask[],
  busyWindows: BusyWindow[],
  range: { start: string; end: string },
): { blocks: PlannedBlock[]; unscheduled: PlanningTask[] } {
  const rangeStart = Date.parse(range.start);
  const rangeEnd = Date.parse(range.end);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) {
    throw new Error("invalid planning range");
  }

  const busy = busyWindows
    .map((window) => ({ start: Date.parse(window.start), end: Date.parse(window.end) }))
    .filter((window) =>
      Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start
    )
    .sort((a, b) => a.start - b.start);
  const free = subtractBusy({ start: rangeStart, end: rangeEnd }, busy);
  const blocks: PlannedBlock[] = [];
  const unscheduled: PlanningTask[] = [];

  for (const task of [...tasks].sort(compareTasks)) {
    const duration = Math.max(5, task.estimatedMinutes ?? 30) * 60_000;
    const slotIndex = free.findIndex((slot) => slot.end - slot.start >= duration);
    if (slotIndex < 0) {
      unscheduled.push(task);
      continue;
    }
    const slot = free[slotIndex];
    const start = slot.start;
    const end = start + duration;
    blocks.push({
      taskId: task.id,
      title: task.title,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      atRisk: task.dueAt ? end > Date.parse(task.dueAt) : false,
    });
    if (end === slot.end) free.splice(slotIndex, 1);
    else free[slotIndex] = { start: end, end: slot.end };
  }
  return { blocks, unscheduled };
}
