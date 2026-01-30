const { Client, GatewayIntentBits } = require('discord.js');
const { Client: NotionClient } = require('@notionhq/client');
const Anthropic = require('@anthropic-ai/sdk');
const AsciiTable = require('ascii-table');

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const ALLOWED_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Initialize clients
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const notion = new NotionClient({ auth: NOTION_TOKEN });
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

// Parse date string into ISO format (YYYY-MM-DD)
function parseDate(dateStr) {
  const now = new Date();
  const currentYear = now.getFullYear();

  // ISO format: 2026-02-15
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // MM/DD or M/D format: 2/15 or 02/15
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const month = slashMatch[1].padStart(2, '0');
    const day = slashMatch[2].padStart(2, '0');
    return `${currentYear}-${month}-${day}`;
  }

  // Month name format: Feb 15, February 15
  const monthNames = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12',
  };

  const monthMatch = dateStr.match(/^([a-z]+)\s+(\d{1,2})$/i);
  if (monthMatch) {
    const monthKey = monthMatch[1].toLowerCase();
    const month = monthNames[monthKey];
    if (month) {
      const day = monthMatch[2].padStart(2, '0');
      return `${currentYear}-${month}-${day}`;
    }
  }

  return null; // Invalid format
}

// Normalize status input to Notion status values
function normalizeStatus(input) {
  const statusMap = {
    'not started': 'Not started',
    'notstarted': 'Not started',
    'todo': 'Not started',
    'in progress': 'In progress',
    'inprogress': 'In progress',
    'doing': 'In progress',
    'done': 'Done',
    'complete': 'Done',
    'completed': 'Done',
  };
  return statusMap[input.toLowerCase()] || input;
}

// Parse command: !task [-high|-medium|-low] [-due DATE] [-status STATUS] [-id ID] Task description
function parseTaskCommand(content) {
  let remaining = content.slice(5).trim(); // Remove "!task"
  let priority = null;
  let dueDate = null;
  let status = null;
  let taskId = null;

  // Extract flags in any order
  let foundFlag = true;
  while (foundFlag) {
    foundFlag = false;

    // Check for priority flag
    const priorityMatch = remaining.match(/^-(high|medium|low)\s+/i);
    if (priorityMatch) {
      priority = priorityMatch[1].charAt(0).toUpperCase() + priorityMatch[1].slice(1).toLowerCase();
      remaining = remaining.slice(priorityMatch[0].length).trim();
      foundFlag = true;
      continue;
    }

    // Check for due date flag
    const dueMatch = remaining.match(/^-due\s+(\S+(?:\s+\d{1,2})?)\s*/i);
    if (dueMatch) {
      const dateStr = dueMatch[1];
      dueDate = parseDate(dateStr);
      remaining = remaining.slice(dueMatch[0].length).trim();
      foundFlag = true;
      continue;
    }

    // Check for status flag (supports multi-word like "in progress")
    const statusMatch = remaining.match(/^-status\s+(not started|in progress|done|todo|doing|complete|completed|notstarted|inprogress)\s*/i);
    if (statusMatch) {
      status = normalizeStatus(statusMatch[1]);
      remaining = remaining.slice(statusMatch[0].length).trim();
      foundFlag = true;
      continue;
    }

    // Check for ID flag (for updating existing tasks)
    const idMatch = remaining.match(/^-id\s+(\d+)\s*/i);
    if (idMatch) {
      taskId = parseInt(idMatch[1], 10);
      remaining = remaining.slice(idMatch[0].length).trim();
      foundFlag = true;
      continue;
    }
  }

  return { taskName: remaining, priority, dueDate, status, taskId };
}

// Create task in Notion
async function createNotionTask(taskName, priority, dueDate, status) {
  const properties = {
    'Task name': {
      title: [{ text: { content: taskName } }],
    },
    'Status': {
      status: { name: status || 'Not started' },
    },
  };

  if (priority) {
    properties['Priority'] = {
      select: { name: priority },
    };
  }

  if (dueDate) {
    properties['Due date'] = {
      date: { start: dueDate },
    };
  }

  const response = await notion.pages.create({
    parent: { database_id: NOTION_DATABASE_ID },
    properties,
  });

  return response;
}

// Find task by ID in Notion database
async function findTaskById(taskId) {
  const response = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    filter: {
      property: 'ID',
      unique_id: {
        equals: taskId,
      },
    },
  });

  return response.results[0] || null;
}

// Update task in Notion (supports status, due date, and priority)
async function updateTask(pageId, updates) {
  const properties = {};

  if (updates.status) {
    properties['Status'] = {
      status: { name: updates.status },
    };
  }

  if (updates.dueDate) {
    properties['Due date'] = {
      date: { start: updates.dueDate },
    };
  }

  if (updates.priority) {
    properties['Priority'] = {
      select: { name: updates.priority },
    };
  }

  const response = await notion.pages.update({
    page_id: pageId,
    properties,
  });

  return response;
}

// Get all incomplete tasks from Notion
async function getIncompleteTasks() {
  const response = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    filter: {
      property: 'Status',
      status: {
        does_not_equal: 'Done',
      },
    },
    sorts: [
      {
        property: 'Due date',
        direction: 'ascending',
      },
    ],
  });

  return response.results.map((page) => {
    const id = page.properties['ID']?.unique_id?.number || null;
    const name = page.properties['Task name']?.title?.[0]?.plain_text || 'Unknown';
    const status = page.properties['Status']?.status?.name || 'Unknown';
    const dueDate = page.properties['Due date']?.date?.start || null;

    return { id, name, status, dueDate };
  });
}

// Extract task ID from Notion page response
function getTaskId(page) {
  const idProp = page.properties['ID'];
  if (idProp && idProp.unique_id) {
    return idProp.unique_id.number;
  }
  return null;
}

// Extract task name from Notion page response
function getTaskName(page) {
  const titleProp = page.properties['Task name'];
  if (titleProp && titleProp.title && titleProp.title[0]) {
    return titleProp.title[0].plain_text;
  }
  return 'Unknown';
}

// Parse command using Claude for natural language understanding
async function parseWithClaude(commandText) {
  if (!anthropic) return null;

  const prompt = `Parse this task bot command and extract the structured data. The command is: "${commandText}"

Valid statuses are: "Not started", "In progress", "Done"
Valid priorities are: "High", "Medium", "Low"
Dates should be in YYYY-MM-DD format.

Return ONLY valid JSON (no markdown, no explanation) with these fields:
{
  "taskId": number or null (if updating existing task),
  "taskName": string or null (for new tasks),
  "status": "Not started" | "In progress" | "Done" | null,
  "priority": "High" | "Medium" | "Low" | null,
  "dueDate": "YYYY-MM-DD" | null
}

Examples:
- "!task -id 7 update the status to complete" → {"taskId": 7, "taskName": null, "status": "Done", "priority": null, "dueDate": null}
- "!task mark task 5 as in progress" → {"taskId": 5, "taskName": null, "status": "In progress", "priority": null, "dueDate": null}
- "!task -id 7 update due date to jan 30" → {"taskId": 7, "taskName": null, "status": null, "priority": null, "dueDate": "${new Date().getFullYear()}-01-30"}
- "!task -id 3 change priority to high" → {"taskId": 3, "taskName": null, "status": null, "priority": "High", "dueDate": null}
- "!task high priority finish report by feb 20" → {"taskId": null, "taskName": "finish report", "status": null, "priority": "High", "dueDate": "${new Date().getFullYear()}-02-20"}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });

    let text = response.content[0].text.trim();
    console.log('Claude raw response:', text);

    // Strip markdown code blocks if present
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(text);
    console.log('Claude parsed result:', parsed);
    return parsed;
  } catch (error) {
    console.error('Claude parsing error:', error);
    return null;
  }
}

// Check if command needs Claude interpretation
function needsClaudeInterpretation(parsed) {
  const { taskName, taskId, status, dueDate, priority } = parsed;

  // Has task ID but remaining text suggests natural language intent
  if (taskId !== null && taskName) {
    const nlKeywords = /\b(update|change|set|mark|move|switch|make)\b/i;
    if (nlKeywords.test(taskName)) return true;

    // Due date or priority keywords without explicit flags
    const dueDateKeywords = /\b(due|deadline|date)\b/i;
    const priorityKeywords = /\b(priority|urgent|important)\b/i;
    if (dueDateKeywords.test(taskName) && !dueDate) return true;
    if (priorityKeywords.test(taskName) && !priority) return true;
  }

  // Task name contains status-like words that weren't parsed
  if (taskName) {
    const statusKeywords = /\b(complete|finished|progress|started|doing|todo)\b/i;
    if (statusKeywords.test(taskName) && !status) return true;
  }

  return false;
}

// Discord event handlers
discord.once('ready', () => {
  console.log(`✅ Bot is online as ${discord.user.tag}`);
});

discord.on('messageCreate', async (message) => {
  // Ignore bots and messages without prefix
  if (message.author.bot) return;
  if (ALLOWED_CHANNEL_ID && message.channel.id !== ALLOWED_CHANNEL_ID) return;

  // Handle !tasks command - list incomplete tasks
  if (message.content.toLowerCase() === '!tasks') {
    try {
      const tasks = await getIncompleteTasks();

      if (tasks.length === 0) {
        await message.reply('🎉 No open tasks! All caught up.');
        return;
      }

      const table = new AsciiTable(`Open Tasks (${tasks.length})`);
      table.setHeading('ID', 'Task', 'Status', 'Due');

      tasks.forEach((task) => {
        table.addRow(
          task.id || '-',
          task.name.length > 30 ? task.name.slice(0, 27) + '...' : task.name,
          task.status,
          task.dueDate || '-'
        );
      });

      await message.reply(`\`\`\`\n${table.toString()}\n\`\`\``);
    } catch (error) {
      console.error('Error fetching tasks:', error);
      await message.reply('❌ Failed to fetch tasks. Check the bot logs.');
    }
    return;
  }

  if (!message.content.toLowerCase().startsWith('!task ')) return;

  // First try regex-based parsing
  let parsed = parseTaskCommand(message.content);

  // Use Claude if the command seems like natural language
  if (needsClaudeInterpretation(parsed) && anthropic) {
    const claudeParsed = await parseWithClaude(message.content);
    if (claudeParsed) {
      parsed = {
        taskName: claudeParsed.taskName,
        priority: claudeParsed.priority,
        dueDate: claudeParsed.dueDate,
        status: claudeParsed.status,
        taskId: claudeParsed.taskId,
      };
    }
  }

  const { taskName, priority, dueDate, status, taskId } = parsed;

  try {
    // Update existing task by ID
    if (taskId !== null) {
      const existingTask = await findTaskById(taskId);
      if (!existingTask) {
        await message.reply(`❌ Task with ID **${taskId}** not found.`);
        return;
      }

      // Build updates object with provided fields
      const updates = {};
      if (status) updates.status = status;
      if (dueDate) updates.dueDate = dueDate;
      if (priority) updates.priority = priority;

      // Require at least one field to update
      if (Object.keys(updates).length === 0) {
        await message.reply(`❌ No updates specified. Use \`-status\`, \`-due\`, \`-priority\`, or natural language like "update due date to Jan 30".`);
        return;
      }

      await updateTask(existingTask.id, updates);
      const existingTaskName = getTaskName(existingTask);

      // Build update summary
      const updateParts = [];
      if (updates.status) updateParts.push(`status → **${updates.status}**`);
      if (updates.dueDate) updateParts.push(`due date → **${updates.dueDate}**`);
      if (updates.priority) updateParts.push(`priority → **${updates.priority}**`);

      await message.reply(`✅ Task #${taskId} updated (${updateParts.join(', ')}): ${existingTaskName}\n<${existingTask.url}>`);
      return;
    }

    // Create new task
    if (!taskName) {
      await message.reply('❌ Please provide a task name.\n**Create:** `!task [-high|-medium|-low] [-due DATE] [-status STATUS] Your task`\n**Update:** `!task -id ID [-status STATUS]`\nDate formats: `2026-02-15`, `Feb 15`, `2/15`\nStatuses: `not started`, `in progress`, `done`');
      return;
    }

    const page = await createNotionTask(taskName, priority, dueDate, status);
    const newTaskId = getTaskId(page);
    const idText = newTaskId ? `#${newTaskId} ` : '';
    const priorityText = priority ? ` [${priority}]` : '';
    const dueText = dueDate ? ` (due: ${dueDate})` : '';
    const statusText = status ? ` → ${status}` : '';
    await message.reply(`✅ Task ${idText}created${priorityText}${dueText}${statusText}: **${taskName}**\n<${page.url}>`);
  } catch (error) {
    console.error('Error with task operation:', error);
    await message.reply('❌ Failed to process task. Check the bot logs.');
  }
});

// Start bot
discord.login(DISCORD_TOKEN);
