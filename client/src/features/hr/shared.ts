/**
 * HR — the page shell and the employee-picker row shape.
 *
 * `shell` was declared independently in all ten HR screen files (audit F14:
 * "`const shell` is defined independently in 28 files rather than imported
 * once"). Splitting `pages.tsx` made an eleventh, which is the point at which it
 * was worth stopping. `EmployeeLite` is the shape every "pick an employee"
 * select needs and nothing more.
 */
import { pageShell } from "@/lib/layout";

export const shell = pageShell.wide;

export type EmployeeLite = { employee_id: string; full_name?: string | null };
