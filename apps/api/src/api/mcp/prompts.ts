import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

/**
 * The four workflows. `docs/research/MCP-TOOL-SURFACE.md` §4 designs them; **this file is the text.**
 *
 * The citation used to read *"reproduced from … §4"*, which was true when it was written and then quietly
 * stopped being: §4 went on telling the agent to call `set_goal_focus` for a whole release after these
 * were rewritten, so the stated provenance pointed at the pre-A2 design. §4 is a summary of the shape and
 * the refusals now, and says so; the exact wording lives here and nowhere else, so there is no second
 * copy to drift. `tests/mcp/surface.test.ts` checks that §4 still names these four prompts.
 *
 * These are not convenience macros — they are where the product's *judgement* lives. Every one of them
 * ends by constraining what the agent may do on its own: `plan_the_week` forbids creating or completing
 * tasks, `review_the_carry` forbids offering a fourth exit, `triage_the_backlog` says out loud that a
 * conversion consumes the item, `goal_health_check` forbids proposing a deletion. Removing those lines
 * would turn a careful workflow into an autonomous one.
 *
 * ⚠ **A2** — all four are rewritten around weekly GOALS. `plan_the_week` no longer walks a checklist of
 * branches to activate with a focus sentence each (there is no focus and no `save_weekly_plan`); it
 * writes weekly goals. `process_ideas` is deleted with the entity (R-rm-1). Two new refusals are stated
 * out loud because an agent would otherwise reach for them: do not delete a past week's weekly goal to
 * tidy up, and do not re-plan a weekly goal — it cannot be moved, and the honest answer is a new one.
 */
const user = (text: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] });

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'plan_the_week',
    {
      title: 'Plan this week',
      description: "Walk through this week's planning: read what is already written and what is carrying, agree which weekly goals this week needs, write them, then pull backlog into them.",
      argsSchema: z.object({ notes: z.string().max(2000).default('').describe('Anything the user already said about the week ahead.') }),
    },
    ({ notes }) =>
      user(`Plan this week in Goal Cascade.

1. Read goalcascade://week/current, and list_lens(lens="Monthly") for the month this week sits in.
2. Tell me, in a short list: the weekly goals already written for this week; the ones CARRYING open
   work in from earlier weeks, oldest first, with the ages of that work; and which monthly goals have
   nothing planned for this week at all.
3. Ask me what this week should hold. Suggest a shortlist based on: monthly goals with nothing planned
   this week, lines that are already carrying open work, goals whose pulse is "At risk" or "Rethink",
   and goals with backlog items ready to pull. Do not decide for me.
4. For each one I confirm, draft the weekly goal's title — one line, concrete, in my voice — and read
   it back before writing anything. A weekly goal is usually this week's version of a monthly one, so
   the monthly goal's own title is often the right starting point.
5. Write them with create_goal(horizon="Weekly"), one at a time, under the monthly goal each belongs
   to. Several weekly goals under one monthly goal is normal — that is how a week holds more than one
   intention. If I want to repeat what I did last week for a line, repeat_last_week copies it in one
   call; tell me what it will create before you call it.
6. Then, for each new weekly goal, list the backlog items sitting on the goals above it (get_goal's
   pull_list) and ask which to pull. Convert only the ones I name.

There is nothing to "stand down": a weekly goal I simply do not write is a week that does not have
one. Do not create, complete, or cancel any task in this workflow unless I ask, and do not delete a
weekly goal from a past week to tidy up — past weeks are the record of what happened.

My notes for this week: ${notes}`),
  );

  server.registerPrompt(
    'review_the_carry',
    {
      title: 'Review what is carrying',
      description: 'Look at every task that has carried, read its timeline, give an honest reading, and offer exactly the three exits this product has.',
      argsSchema: z.object({ weeks: z.coerce.number().int().min(1).max(52).default(2).describe('Minimum carry age to report on.') }),
    },
    ({ weeks }) =>
      user(`Show me what is carrying and help me decide what to do about it.

1. Call list_tasks(week_offset=0, state="carrying"). Use goalcascade://week/current to group them by
   life goal and to see which weekly goals are in the CARRIED band — those are the intentions whose
   week has passed while their work stayed open.
2. For every task at least ${weeks} weeks old, call get_task and read its activity timeline. Tell me:
   when it was created and from where (a goal, a backlog pull, the + drawer), how many weeks it has
   carried, whether it has ever been renamed or had its done-condition changed, and which week its
   weekly goal was written for.
3. For each one, state the honest reading in one line — for example: "carried 4 weeks, no
   done-condition, its weekly goal was written for the week of 10 Aug".
4. Then offer me exactly the three exits this product has, and nothing else:
     - Complete it (complete_task)
     - Move it to the backlog (move_task_to_backlog) — it keeps its description and links, and it
       lands on the goal ABOVE its week, normally the monthly parent
     - Cancel it (cancel_task)
   Never offer to defer, snooze, reschedule, or move a task to a different week. Those do not exist,
   and a task's week is its own stored field that nothing may rewrite.
5. Act only on what I choose. When I give a reason, pass it through verbatim; when I do not, leave the
   reason empty — this product never requires one.

Do not create, edit or delete any goal in this workflow. In particular, do not "clean up" a weekly
goal whose week has passed: it is the record of what that week was for.`),
  );

  server.registerPrompt(
    'triage_the_backlog',
    {
      title: 'Triage the backlog',
      description: 'Group the backlog by owning goal, say which items have a weekly goal ready to receive them this week, and walk through them a few at a time.',
      argsSchema: z.object({ goal: z.string().max(200).default('').describe('A goal name or branch to limit the triage to.') }),
    },
    ({ goal }) =>
      user(`Help me triage the Goal Cascade backlog${goal ? ` under "${goal}"` : ''}.

1. If a goal was named, resolve it with find_goal first and confirm which one I mean before going on.
2. Call list_backlog (scoped with goal_id if a goal was named). Group items by their owning goal,
   newest first.
3. Cross-reference list_lens(lens="Weekly") for this week: an item can become work this week only if a
   weekly goal exists at or under its goal for this week. Summarise how many items there are, how they
   split across lines, and how many have a weekly goal ready to receive them.
4. Walk me through them a few at a time. For each, propose one of:
     - pull it into this week (convert_backlog_item_to_task) — say which weekly goal will receive it,
       and if there is more than one candidate, ask me which
     - move it to a better-fitting goal (move_backlog_item)
     - delete it (delete_backlog_item) — say clearly that this is permanent and has no undo
     - leave it
5. Where no weekly goal exists for this week, that is not a dead end: convert_backlog_item_to_task
   takes \`new_weekly_goal\`, which creates the weekly goal and the task in one step. Propose the title
   (usually the monthly goal's own) and get my agreement before you create anything — nothing should
   appear that I did not ask for.

Converting consumes the item — it becomes a task and leaves the backlog. Say so before the first
conversion.`),
  );

  server.registerPrompt(
    'goal_health_check',
    {
      title: 'Honest health check of the goal tree',
      description: 'Flag months with nothing planned, periods that have already passed, at-risk goals with nothing written for this week, and plans that went stale before their week — with the specific move for each.',
      argsSchema: z.object({ life_goal: z.string().max(200).default('').describe('Limit to one Life line.') }),
    },
    ({ life_goal }) =>
      user(`Give me an honest health check of my goal tree${life_goal ? ` for "${life_goal}"` : ''}.

1. Read goalcascade://life and goalcascade://week/current, then list_lens for the Monthly and
   Quarterly lenses at their current periods. If a life goal was named, resolve it with find_goal and
   scope everything below to that line.
2. For each life goal report: how many weekly goals it has this week, how many tasks are carrying and
   the oldest age, how many backlog items sit under it, and the pulse of each child.
3. Flag, without softening: monthly goals whose weekly_breakdown says nothing is planned for this week
   or nothing at all this month; goals whose period has already passed; goals marked "At risk" or
   "Rethink" with nothing written for this week beneath them; and weekly goals whose planned_age_weeks
   is 2 or more, which were written well before the week they are for.
4. For each flag, offer the specific move: replan_goal (say which period, using the replan_options
   from get_goal — do not invent a period, and remember a WEEKLY goal cannot be re-planned at all),
   update_goal to change the pulse, create_goal(horizon="Weekly") to give a month a week, or move_goal
   if the goal is hanging off the wrong parent.
5. Read out any learnings attached to this line (list_learnings) and ask whether any of them should
   change the plan. If one already did, offer update_learning with applied=true.

Never propose deleting a goal in this workflow. If deletion genuinely looks right, say so in words and
stop — I will ask for it explicitly.`),
  );
}
