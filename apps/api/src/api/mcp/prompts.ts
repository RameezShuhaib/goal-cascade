import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

/**
 * The five workflows, reproduced from `docs/research/MCP-TOOL-SURFACE.md` §4.
 *
 * These are not convenience macros — they are where the product's *judgement* lives. Every one of them
 * ends by constraining what the agent may do on its own: `plan_the_week` forbids creating or completing
 * tasks, `review_the_carry` forbids offering a fourth exit, `process_ideas` forbids batching,
 * `goal_health_check` forbids proposing a deletion. Removing those lines would turn a careful workflow
 * into an autonomous one.
 */
const user = (text: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] });

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'plan_the_week',
    {
      title: 'Plan this week',
      description: "Walk through this week's planning: read the current state, agree which branches to activate, draft one focus sentence each, then pull backlog.",
      argsSchema: z.object({ notes: z.string().max(2000).default('').describe('Anything the user already said about the week ahead.') }),
    },
    ({ notes }) =>
      user(`Plan this week in Goal Cascade.

1. Read goalcascade://week/current and goalcascade://tree/outline.
2. Tell me, in a short list: which branches are active right now and what each focus sentence says;
   which branches are dormant; and which open tasks are carrying, with their ages.
3. Ask me which branches should be active this week. Suggest a shortlist based on: branches that
   already carry open tasks, branches whose goal pulse is "At risk" or "Rethink", and branches with
   backlog items ready to pull. Do not decide for me.
4. For each branch I confirm, draft one focus sentence — one sentence, concrete, in my voice — and
   read it back before writing anything.
5. Write the plan with set_goal_focus one branch at a time. Use clear_goal_focus for branches I want
   to stand down. Only use save_weekly_plan if I explicitly ask you to replace the whole week, and if
   you do, tell me exactly which branches will go dormant before you call it.
6. Then, for each newly active branch, list its pullable backlog items (list_backlog with
   convertible_only) and ask which to pull. Convert only the ones I name.

Do not create, complete, or cancel any task in this workflow unless I ask.

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

1. Call list_tasks(week_offset=0, state="carrying"). Group the results by Life goal, using
   goalcascade://tree/outline for the paths.
2. For every task at least ${weeks} weeks old, call get_task and read its activity timeline. Tell me:
   when it was created and from where (planning, backlog, an idea, the drawer), how many weeks it has
   carried, whether it has ever been renamed or had its done-condition changed, and whether its branch
   still has a focus this week.
3. For each one, state the honest reading in one line — for example: "carried 4 weeks, no
   done-condition, branch went dormant in week -2".
4. Then offer me exactly the three exits this product has, and nothing else:
     - Complete it (complete_task)
     - Move it to the backlog (move_task_to_backlog) — it keeps its description and links
     - Cancel it (cancel_task)
   Never offer to defer, snooze, reschedule, or move a task to a different week. Those do not exist.
5. Act only on what I choose. When I give a reason, pass it through verbatim; when I do not, leave the
   reason empty — this product never requires one.

Do not change any focus sentence or any goal in this workflow.`),
  );

  server.registerPrompt(
    'triage_the_backlog',
    {
      title: 'Triage the backlog',
      description: 'Group the backlog by branch, say what could become work this week, and walk through the convertible items a few at a time.',
      argsSchema: z.object({ goal: z.string().max(200).default('').describe('A goal name or branch to limit the triage to.') }),
    },
    ({ goal }) =>
      user(`Help me triage the Goal Cascade backlog${goal ? ` under "${goal}"` : ''}.

1. If a goal was named, resolve it with find_goal first and confirm which one I mean before going on.
2. Call list_backlog (scoped with under_goal_id if a goal was named). Group items by branch path,
   newest first, and mark each one as convertible or not.
3. Summarise: how many items, how they split across branches, how many could become work this week,
   and which branches are blocking the rest because they have no focus this week.
4. Walk me through the convertible items a few at a time. For each, propose one of:
     - pull it into this week (convert_backlog_item_to_task) — say which active leaf will receive it,
       and if there is more than one candidate, ask me which
     - move it to a better-fitting goal (move_backlog_item)
     - delete it (delete_backlog_item) — say clearly that this is permanent and has no undo
     - leave it
5. For non-convertible items, tell me which branch would need a focus first. Offer to set one with
   set_goal_focus, but do not set one without my say-so.

Converting consumes the item — it becomes a task and leaves the backlog. Say so before the first
conversion.`),
  );

  server.registerPrompt(
    'process_ideas',
    {
      title: 'Clear the parking lot',
      description: 'Go through parked ideas one at a time and offer exactly the things an idea can become.',
      argsSchema: z.object({}),
    },
    () =>
      user(`Clear the Goal Cascade parking lot with me.

1. Call list_ideas and read goalcascade://tree/outline.
2. Read the ideas back grouped by Life goal, with Unsorted last. Keep it short — these are two-second
   captures, not documents.
3. Go through them one at a time and offer exactly the three things an idea can become:
     - a task this week (convert_idea_to_task) — name the active leaf it would land under; if no
       branch is active, say so and offer to set a focus first rather than picking some other goal
     - a backlog item on a goal (attach_idea_to_goal) — the target must be a Yearly, Quarterly or
       Monthly goal, never a Life goal
     - deleted (delete_idea)
   An idea can also stay parked. That is a real answer; offer it.
4. If an idea reads more like an insight than a piece of work — something that would change the plan
   rather than something to do — say so and offer capture_learning instead, then delete the idea.

Do not batch-convert. One decision at a time, mine.`),
  );

  server.registerPrompt(
    'goal_health_check',
    {
      title: 'Honest health check of the goal tree',
      description: 'Flag dormant branches still carrying work, passed target periods, at-risk goals with no active leaf, and empty Monthly goals — with the specific move for each.',
      argsSchema: z.object({ life_goal: z.string().max(200).default('').describe('Limit to one Life line.') }),
    },
    ({ life_goal }) =>
      user(`Give me an honest health check of my goal tree${life_goal ? ` for "${life_goal}"` : ''}.

1. Read goalcascade://tree/outline and goalcascade://week/current. If a Life goal was named, resolve
   it with find_goal and scope everything below to that line.
2. For each Life goal report: how many of its branches are active this week, how many tasks are
   carrying and the oldest age, how many backlog items sit under it, and the pulse of each child.
3. Flag, without softening: branches that have been dormant while still carrying open tasks; goals
   whose target period has already passed; goals marked "At risk" or "Rethink" with no active leaf
   beneath them; and Monthly goals with an empty backlog and no tasks.
4. For each flag, offer the specific move: replan_goal (say which period, using the replan_options
   from get_goal — do not invent a period), update_goal to change the pulse, set_goal_focus to wake a
   branch, or move_goal if the goal is hanging off the wrong parent.
5. Read out any learnings attached to this line (list_learnings) and ask whether any of them should
   change the plan. If one already did, offer update_learning with applied=true.

Never propose deleting a goal in this workflow. If deletion genuinely looks right, say so in words and
stop — I will ask for it explicitly.`),
  );
}
