import Anthropic from '@anthropic-ai/sdk';
import { loadEnv, type Plugin } from 'vite';

// Unit personality system prompts keyed by unit type.
const UNIT_PERSONALITIES: Record<string, string> = {
  engineer:
    'You gather resources and build structures. Prioritize nearby resources. Return to base when carrying resources.',
  scout:
    'You explore unknown areas and report enemy positions. Avoid combat. Move toward unexplored regions.',
  soldier:
    'You engage enemies in combat. Attack nearby threats. Follow attack commands.',
  captain:
    'You coordinate nearby troops. Issue orders to friendly units. Lead from the front.',
  messenger:
    'You carry messages between units. Move quickly to relay commands. Avoid danger.',
  spy:
    'You gather intelligence behind enemy lines. Report enemy positions. Stay hidden and avoid direct combat.',
  siege:
    'You bombard enemy positions from long range. Stay behind friendly lines. Target the strongest enemies.',
};

const SYSTEM_PROMPT_PREFIX = `You are an AI controlling a unit in a real-time strategy game. You MUST respond by calling the take_action tool with your chosen action. Be decisive and brief.

Your role: `;

// ---- Strategic Commander ----

const COMMANDER_SYSTEM_PROMPT = `You are a strategic commander in an RTS game. Issue high-level directives to your units. Be decisive. Focus on economy early, defense when threatened, aggression when strong.

CRITICAL: If a unit has a STANDING ORDER from the player, your directive for that unit MUST fulfill that order. Player commands are your top priority — never override, ignore, or contradict them. Only deviate if the unit is dead or the order is physically impossible.

You MUST respond by calling the issue_directives tool.`;

const DIRECTIVE_TOOL: Anthropic.Tool = {
  name: 'issue_directives',
  description: 'Issue high-level directives to all your units.',
  input_schema: {
    type: 'object' as const,
    properties: {
      directives: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            unitId: { type: 'string', description: 'The unit ID to command.' },
            type: {
              type: 'string',
              enum: [
                'gather_resources', 'explore_area', 'defend_position',
                'attack_move', 'patrol_area', 'build_structure',
                'retreat', 'escort', 'idle',
              ],
              description: 'The directive type.',
            },
            target: {
              type: 'object',
              properties: {
                col: { type: 'number', description: '0-indexed column (0 = left edge).' },
                row: { type: 'number', description: '0-indexed row (0 = top edge).' },
              },
              description: 'Target grid position (0-indexed). Use the col/row numbers shown in the prompt.',
            },
            targetUnitId: { type: 'string', description: 'Target unit ID (for escort/attack).' },
            buildingType: {
              type: 'string',
              enum: ['base', 'barracks', 'factory', 'watchtower'],
              description: 'Building type (for build_structure).',
            },
            priority: { type: 'number', description: 'Priority 1-5 (5=highest).' },
            reasoning: { type: 'string', description: 'Brief reasoning (1 sentence).' },
          },
          required: ['unitId', 'type'],
        },
        description: 'Array of directives, one per unit.',
      },
    },
    required: ['directives'],
  },
};

// ---- Per-unit action tool ----

const ACTION_TOOL: Anthropic.Tool = {
  name: 'take_action',
  description: 'Choose an action for this unit to take.',
  input_schema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        enum: ['move', 'attack', 'gather', 'build', 'communicate', 'idle'],
        description: 'The action type.',
      },
      target: {
        type: 'object',
        properties: {
          col: { type: 'number', description: 'Grid column' },
          row: { type: 'number', description: 'Grid row' },
        },
        description:
          'Target grid position for move/gather actions.',
      },
      targetUnitId: {
        type: 'string',
        description: 'ID of the unit to attack (for attack actions).',
      },
      message: {
        type: 'string',
        description: 'Message content (for communicate actions).',
      },
      buildingType: {
        type: 'string',
        enum: ['base', 'barracks', 'factory', 'watchtower'],
        description: 'Building to construct (for build actions).',
      },
      details: {
        type: 'string',
        description: 'Brief reasoning for the action (1 sentence).',
      },
    },
    required: ['type'],
  },
};

export function aiPlugin(): Plugin {
  let client: Anthropic | null = null;
  /** Timestamp (ms) before which we refuse new requests (rate-limit backoff). */
  let rateLimitUntil = 0;

  return {
    name: 'ai-proxy',
    configureServer(server) {
      // Load env vars from .env / .env.local (Vite doesn't auto-populate process.env)
      const env = loadEnv('development', process.cwd(), '');
      const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (apiKey && apiKey !== 'your-key-here') {
        client = new Anthropic({ apiKey, maxRetries: 0 });
        console.log('[ai-plugin] Anthropic client initialized');
      } else {
        console.warn(
          '[ai-plugin] ANTHROPIC_API_KEY not set — LLM endpoint disabled',
        );
      }

      server.middlewares.use('/api/think', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        if (!client) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: 'LLM not configured' }));
          return;
        }

        // Rate-limit backoff: reject immediately if cooling down
        if (Date.now() < rateLimitUntil) {
          const remaining = Math.round((rateLimitUntil - Date.now()) / 1000);
          console.log(`[ai-plugin] Rate limited, ${remaining}s remaining`);
          res.statusCode = 429;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Rate limited, ${remaining}s remaining` }));
          return;
        }

        // Read body
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());

        const { perception, unitType } = body as {
          perception: string;
          unitType: string;
        };

        const personality =
          UNIT_PERSONALITIES[unitType] ?? UNIT_PERSONALITIES.soldier;

        try {
          const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            system: SYSTEM_PROMPT_PREFIX + personality,
            tools: [ACTION_TOOL],
            tool_choice: { type: 'tool', name: 'take_action' },
            messages: [{ role: 'user', content: perception }],
          });

          // Extract tool_use block
          const toolBlock = response.content.find(
            (b): b is Anthropic.ContentBlock & { type: 'tool_use' } =>
              b.type === 'tool_use',
          );

          if (toolBlock) {
            console.log(`[ai-plugin] ${unitType} action:`, JSON.stringify(toolBlock.input));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(toolBlock.input));
          } else {
            console.log('[ai-plugin] No tool_use block found. Response:', JSON.stringify(response.content));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ type: 'idle' }));
          }
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          if (err?.status === 429) {
            // Rate limit — back off
            const retryAfter = parseInt(err?.headers?.get?.('retry-after') || '60', 10);
            rateLimitUntil = Date.now() + retryAfter * 1000;
            console.warn(`[ai-plugin] Rate limited — backing off ${retryAfter}s`);
            res.statusCode = 429;
          } else if (err?.status === 400 || err?.status === 401) {
            // Permanent failure (out of credits, bad key) — tell client to disable
            console.error('[ai-plugin] Permanent API error (disabling):', errMsg);
            res.statusCode = 503;
          } else {
            // Transient error — client will retry next think cycle
            console.error('[ai-plugin] Anthropic API error:', errMsg);
            res.statusCode = 502;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: errMsg }));
        }
      });

      // ---- Strategic Commander endpoint ----
      server.middlewares.use('/api/command', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        if (!client) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: 'LLM not configured' }));
          return;
        }

        if (Date.now() < rateLimitUntil) {
          const remaining = Math.round((rateLimitUntil - Date.now()) / 1000);
          console.log(`[ai-plugin] Commander rate limited, ${remaining}s remaining`);
          res.statusCode = 429;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Rate limited, ${remaining}s remaining` }));
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const { perception } = body as { perception: string };

        try {
          const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            system: COMMANDER_SYSTEM_PROMPT,
            tools: [DIRECTIVE_TOOL],
            tool_choice: { type: 'tool', name: 'issue_directives' },
            messages: [{ role: 'user', content: perception }],
          });

          const toolBlock = response.content.find(
            (b): b is Anthropic.ContentBlock & { type: 'tool_use' } =>
              b.type === 'tool_use',
          );

          if (toolBlock) {
            const input = toolBlock.input as { directives: unknown[] };
            console.log(`[ai-plugin] Commander issued ${input.directives?.length ?? 0} directives`);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(toolBlock.input));
          } else {
            console.log('[ai-plugin] Commander: no tool_use block');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ directives: [] }));
          }
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          if (err?.status === 429) {
            const retryAfter = parseInt(err?.headers?.get?.('retry-after') || '60', 10);
            rateLimitUntil = Date.now() + retryAfter * 1000;
            console.warn(`[ai-plugin] Commander rate limited — backing off ${retryAfter}s`);
            res.statusCode = 429;
          } else if (err?.status === 400 || err?.status === 401) {
            console.error('[ai-plugin] Commander permanent API error (disabling):', errMsg);
            res.statusCode = 503;
          } else {
            console.error('[ai-plugin] Commander API error:', errMsg);
            res.statusCode = 502;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: errMsg }));
        }
      });

      // ---- Unit Q&A endpoint ----
      server.middlewares.use('/api/ask', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        if (!client) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: 'LLM not configured' }));
          return;
        }

        if (Date.now() < rateLimitUntil) {
          const remaining = Math.round((rateLimitUntil - Date.now()) / 1000);
          res.statusCode = 429;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Rate limited, ${remaining}s remaining` }));
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const { perception, unitType, question } = body as {
          perception: string;
          unitType: string;
          question: string;
        };

        const personality =
          UNIT_PERSONALITIES[unitType] ?? UNIT_PERSONALITIES.soldier;

        const systemPrompt = `You are a ${unitType} in an RTS game. Respond to your commander's question. Stay in character. Be brief (1-3 sentences).\n\nYour role: ${personality}`;

        try {
          const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 150,
            system: systemPrompt,
            messages: [
              { role: 'user', content: `Current situation:\n${perception}\n\nCommander asks: ${question}` },
            ],
          });

          const textBlock = response.content.find(
            (b): b is Anthropic.ContentBlock & { type: 'text' } =>
              b.type === 'text',
          );

          const answer = textBlock?.text || 'Unable to respond at this time, Commander.';
          console.log(`[ai-plugin] ${unitType} Q&A: "${question}" -> "${answer}"`);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ answer }));
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          if (err?.status === 429) {
            const retryAfter = parseInt(err?.headers?.get?.('retry-after') || '60', 10);
            rateLimitUntil = Date.now() + retryAfter * 1000;
            console.warn(`[ai-plugin] Q&A rate limited — backing off ${retryAfter}s`);
            res.statusCode = 429;
          } else {
            console.error('[ai-plugin] Q&A API error:', errMsg);
            res.statusCode = 502;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: errMsg }));
        }
      });
    },
  };
}
