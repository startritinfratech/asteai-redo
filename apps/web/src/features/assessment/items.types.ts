/**
 * The screens deeptech_ai sends (psychometric/engine.py, `public()` of each step).
 * Items carry what is needed to draw a question, never its answer.
 */
export interface ShapeSpec {
  shape: 'circle' | 'square' | 'triangle' | 'diamond';
  count: number;
  fill: boolean;
  rot: number;
}

export type ItemBody =
  | { type: 'consent' }
  | { type: 'practice'; prompt: string; options: number[]; practice_answer: number; explanation: string }
  | { type: 'matrix'; level: number; cells: ShapeSpec[]; options: ShapeSpec[] }
  | { type: 'series'; sequence: number[]; options: number[] }
  | { type: 'span'; digits: number[]; backward: boolean; show_ms: number; gap_ms: number }
  | { type: 'numeric'; theme: string; unit: string; rows: { label: string; last: number; this: number }[]; options: string[] }
  | { type: 'code'; test: string; code: string[]; options: number[] }
  | { type: 'schematic'; wires: number }
  | { type: 'dashboard'; theme: string; metric: string; rows: { label: string; rate: number; volume: number }[]; options: string[] }
  | { type: 'triage'; quote: string; options: string[] }
  | { type: 'safety'; theme: string; options: string[] }
  | { type: 'cat'; again: boolean; request: string; options: string[]; index: number; of: number }
  | { type: 'sjt'; follow_up: boolean; who: string; say: string; question: string; options: string[] }
  | { type: 'emo'; message: string; options: string[] }
  | { type: 'codebreak'; length: number; min_digit: number; max_digit: number; attempts: number; history: { guess: string; in_place: number }[] }
  | { type: 'prior'; phase: 1 | 2; tasks: string[]; order: number[]; update?: { who: string; say: string } }
  | { type: 'recovery'; messages: string[]; replies: string[]; options: string[] }
  | { type: 'selfreport'; statement: string; index: number; of: number; scale: string[] }
  | { type: 'debrief' };

export type Item = ItemBody & { id: string; progress: { index: number; total: number } };

/** Sends the response for the current item. */
export type Submit = (response: Record<string, unknown>) => void;
