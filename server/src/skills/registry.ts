import { clockSkill } from './clock.ts';
import { memorySkill } from './memory.ts';
import { remindersSkill } from './reminders.ts';
import type { Skill } from './types.ts';

/**
 * Every skill the assistant has. Add new ones here.
 * Small local models get confused past about six tools in one call, so a skill with a
 * `match` pattern is only offered when the conversation calls for it (see pickSkills in agent.ts).
 *
 * What tools may do, by design: read and write the assistant's own records and reminders.
 * What no tool can do: run commands, read other files, reach the network, or delete anything.
 * Deleting and cancelling stay with the user, in the UI.
 */
export const skills: Skill[] = [memorySkill, clockSkill, remindersSkill];
